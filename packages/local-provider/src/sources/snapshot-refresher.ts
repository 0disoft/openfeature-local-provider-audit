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
  const { provider, source, verifier } = options;
  const format = options.format ?? "json";
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
  let provenance: SignedSnapshotMetadata | undefined;
  let committedArtifact: Uint8Array | undefined;

  async function performRefresh(): Promise<SnapshotRefreshResult> {
    if (closed || provider.getStatus().closed) throw unavailable("Snapshot refresher is closed.");
    const before = provider.getStatus().snapshotHash;
    const conditionalEtag = committedHash === before ? etag : undefined;
    active = new AbortController();
    try {
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
      if (provider.getStatus().snapshotHash !== before) {
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
          verified = verifier.verify(signedBytes, provenance);
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
      provider.updateSnapshot(snapshot);
      const snapshotHash = provider.getStatus().snapshotHash;
      if (snapshotHash !== expectedHash) {
        provider.reportRefreshFailure("load");
        throw unavailable("Snapshot changed during application; retry explicitly.");
      }
      committedHash = snapshotHash;
      if (verified !== undefined) {
        provenance = verified.provenance;
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
      return provider.getStatus().snapshotHash === committedHash ? provenance : undefined;
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
