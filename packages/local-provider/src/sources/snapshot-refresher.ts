import { captureSnapshotProvenance } from "../flags/snapshot-provenance.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { createSnapshotHash } from "../audit/audit-event.js";
import { parseJsonFlagSnapshot } from "../flags/parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "../flags/parse-yaml-snapshot.js";
import type {
  FlagSnapshot,
  SnapshotRefresher,
  SnapshotRefresherOptions,
  SnapshotRefreshResult,
  SnapshotSourceResponse,
  SignedSnapshotMetadata,
  VerifiedFlagSnapshot
} from "../public-types.js";
import { DEFAULT_SOURCE_BYTES, sourceInteger } from "./https-source.js";

export function createSnapshotRefresher(options: SnapshotRefresherOptions): SnapshotRefresher {
  const { provider, source, verifier, store } = options;
  const prepare = store === undefined ? undefined : provider.prepareSnapshot?.bind(provider);
  if (store !== undefined && (verifier === undefined || prepare === undefined))
    throw new TypeError("Durable refresh requires a signed verifier and transactional provider.");
  const format = options.format ?? "json";
  if (options.previous !== undefined && verifier === undefined)
    throw new TypeError("Recovered provenance requires a signed verifier.");
  if (format !== "json" && format !== "yaml")
    throw new TypeError("Snapshot format must be json or yaml.");
  if (verifier !== undefined && format !== "json")
    throw new TypeError("Signed snapshots require JSON format.");
  const maxBytes = sourceInteger(
    "maxBytes",
    options.maxBytes ?? DEFAULT_SOURCE_BYTES,
    1,
    100 * 1024 * 1024
  );
  let etag: string | undefined;
  let committedHash: string | undefined;
  let closed = false;
  let active: AbortController | undefined;
  let inFlight: Promise<SnapshotRefreshResult> | undefined;
  const initial = provider.getStatus().provenance;
  const recovered =
    options.previous === undefined
      ? undefined
      : captureSnapshotProvenance(
          options.previous,
          Object.getOwnPropertyDescriptor(options.previous, "snapshotHash")?.value as string
        );
  let replayFloor: SignedSnapshotMetadata | undefined =
    verifier === undefined
      ? undefined
      : recovered !== undefined && (initial === undefined || recovered.sequence > initial.sequence)
        ? recovered
        : initial;
  if (
    recovered !== undefined &&
    initial !== undefined &&
    (recovered.audience !== initial.audience ||
      (recovered.sequence === initial.sequence && recovered.artifactHash !== initial.artifactHash))
  )
    throw new TypeError("Recovered provenance conflicts with initial provider origin.");
  let provenance: SignedSnapshotMetadata | undefined;
  let committedArtifact: Uint8Array | undefined;

  async function performRefresh(): Promise<SnapshotRefreshResult> {
    if (closed || provider.getStatus().closed) throw unavailable("Snapshot refresher is closed.");
    const beforeStatus = provider.getStatus();
    const before = beforeStatus.snapshotHash;
    const beforeArtifact = beforeStatus.provenance?.artifactHash;
    const conditionalEtag =
      committedHash === before && provenance?.artifactHash === beforeArtifact ? etag : undefined;
    active = new AbortController();
    try {
      if (store !== undefined) {
        try {
          replayFloor = mergeFloor(replayFloor, (await store.load())?.floor);
        } catch {
          provider.reportRefreshFailure("persist");
          throw unavailable("Snapshot persistence is unavailable.");
        }
        if (closed || provider.getStatus().closed)
          throw unavailable("Snapshot refresher is closed.");
        const loaded = provider.getStatus();
        if (loaded.snapshotHash !== before || loaded.provenance?.artifactHash !== beforeArtifact) {
          provider.reportRefreshFailure("load");
          throw unavailable("Snapshot changed during recovery; retry explicitly.");
        }
      }
      let response: SnapshotSourceResponse;
      try {
        response = await source.fetch({
          signal: active.signal,
          ...(conditionalEtag !== undefined ? { etag: conditionalEtag } : {})
        });
      } catch {
        if (!closed && !provider.getStatus().closed) provider.reportRefreshFailure("fetch");
        throw unavailable("Snapshot source could not be refreshed.");
      }
      if (closed || provider.getStatus().closed) throw unavailable("Snapshot refresher is closed.");
      const current = provider.getStatus();
      if (current.snapshotHash !== before || current.provenance?.artifactHash !== beforeArtifact) {
        provider.reportRefreshFailure("load");
        throw unavailable("Snapshot changed during refresh; retry explicitly.");
      }
      let artifact: Uint8Array | undefined;
      try {
        if (response.status === "notModified") {
          if (conditionalEtag === undefined) throw new Error("Unexpected not-modified response.");
        } else if (response.status === "content") {
          if (response.content.byteLength > maxBytes) throw new Error("Snapshot exceeds maxBytes.");
          artifact = verifier === undefined ? response.content : Uint8Array.from(response.content);
        } else {
          throw new Error("Unknown source response.");
        }
      } catch {
        provider.reportRefreshFailure("validation");
        throw new LocalProviderError("SCHEMA_ERROR", "Snapshot source content is invalid.");
      }
      let snapshot: FlagSnapshot;
      let verified: VerifiedFlagSnapshot | undefined;
      if (verifier !== undefined) {
        try {
          const signedBytes = artifact ?? committedArtifact;
          if (signedBytes === undefined) throw new Error("No signed artifact.");
          replayFloor = mergeFloor(replayFloor, beforeStatus.provenance);
          verified = verifier.verify(signedBytes, replayFloor);
          snapshot = verified.snapshot;
        } catch {
          provider.reportRefreshFailure("signature");
          throw new LocalProviderError("SCHEMA_ERROR", "Signed snapshot verification failed.");
        }
      } else {
        try {
          if (artifact === undefined) snapshot = provider.getSnapshot();
          else {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact);
            snapshot =
              format === "json" ? parseJsonFlagSnapshot(text) : parseYamlFlagSnapshot(text);
          }
        } catch {
          provider.reportRefreshFailure("validation");
          throw new LocalProviderError("SCHEMA_ERROR", "Snapshot source content is invalid.");
        }
      }
      // Provider validation failures are already counted there. Commit the validator
      // only after application succeeds; failures leave both snapshot and ETag intact.
      const expectedHash = createSnapshotHash(snapshot);
      if (
        store !== undefined &&
        verified !== undefined &&
        prepare !== undefined &&
        verifier !== undefined
      ) {
        const signedBytes = artifact ?? committedArtifact;
        if (signedBytes === undefined) throw unavailable("No signed artifact is available.");
        const transaction = prepare(snapshot, verified.provenance);
        try {
          if (closed || provider.getStatus().closed)
            throw unavailable("Snapshot refresher is closed.");
          try {
            const acknowledged = await store.commit(Uint8Array.from(signedBytes));
            if (
              acknowledged.provenance.artifactHash !== verified.provenance.artifactHash ||
              acknowledged.provenance.snapshotHash !== expectedHash
            )
              throw new Error();
          } catch {
            provider.reportRefreshFailure("persist");
            throw unavailable("Snapshot persistence is unavailable.");
          }
          // Durable acceptance survives close, later callbacks and ambiguous application.
          replayFloor = verified.provenance;
          if (closed || provider.getStatus().closed)
            throw unavailable("Snapshot refresher is closed after persistence.");
          try {
            const fresh = verifier.verify(signedBytes, replayFloor);
            if (
              fresh.provenance.artifactHash !== verified.provenance.artifactHash ||
              fresh.provenance.snapshotHash !== expectedHash
            )
              throw new Error();
          } catch {
            provider.reportRefreshFailure("signature");
            throw new LocalProviderError("SCHEMA_ERROR", "Signed snapshot verification failed.");
          }
          try {
            transaction.commit();
          } catch {
            provider.reportRefreshFailure("load");
            throw unavailable("Snapshot application failed after persistence.");
          }
        } finally {
          transaction.cancel();
        }
      } else {
        provider.updateSnapshot(snapshot, verified?.provenance);
      }
      const applied = provider.getStatus();
      const snapshotHash = applied.snapshotHash;
      if (
        snapshotHash !== expectedHash ||
        applied.provenance?.artifactHash !== verified?.provenance.artifactHash
      ) {
        provider.reportRefreshFailure("load");
        throw unavailable("Snapshot changed during application; retry explicitly.");
      }
      committedHash = snapshotHash;
      if (verified !== undefined) {
        provenance = verified.provenance;
        replayFloor = verified.provenance;
        if (artifact !== undefined) committedArtifact = artifact;
      }
      if (response.status === "content") etag = response.etag;
      return {
        status: snapshotHash === before ? "unchanged" : "updated",
        snapshotHash,
        ...(provenance !== undefined ? { provenance } : {})
      };
    } finally {
      active = undefined;
    }
  }

  return {
    getProvenance() {
      const status = provider.getStatus();
      return status.snapshotHash === committedHash &&
        status.provenance?.artifactHash === provenance?.artifactHash
        ? provenance
        : undefined;
    },
    refresh() {
      if (inFlight !== undefined) return inFlight;
      inFlight = Promise.resolve()
        .then(performRefresh)
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
    close() {
      closed = true;
      active?.abort();
    }
  };
}

function unavailable(message: string): LocalProviderError {
  return new LocalProviderError("PROVIDER_NOT_READY", message);
}

function mergeFloor(
  previous: SignedSnapshotMetadata | undefined,
  candidate: SignedSnapshotMetadata | undefined
): SignedSnapshotMetadata | undefined {
  if (candidate === undefined) return previous;
  const next = captureSnapshotProvenance(
    candidate,
    Object.getOwnPropertyDescriptor(candidate, "snapshotHash")?.value as string
  );
  if (next === undefined) return previous;
  if (previous === undefined) return next;
  if (
    previous.audience !== next.audience ||
    (previous.sequence === next.sequence && previous.artifactHash !== next.artifactHash) ||
    (previous.sequence < next.sequence && previous.issuedAt > next.issuedAt) ||
    (previous.sequence > next.sequence && previous.issuedAt < next.issuedAt)
  )
    throw unavailable("Snapshot continuity state conflicts.");
  return next.sequence > previous.sequence ? next : previous;
}
