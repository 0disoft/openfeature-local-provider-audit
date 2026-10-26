import { captureSnapshotProvenance } from "../flags/snapshot-provenance.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { createSnapshotHash } from "../audit/audit-event.js";
import { parseJsonFlagSnapshot } from "../flags/parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "../flags/parse-yaml-snapshot.js";
import type {
  FlagSnapshot,
  RefreshFailureKind,
  SnapshotRefresher,
  SnapshotRefresherOptions,
  SnapshotRefreshResult,
  SnapshotSourceResponse,
  SignedSnapshotStore,
  SignedSnapshotMetadata,
  SnapshotVerifier,
  VerifiedFlagSnapshot
} from "../public-types.js";
import { DEFAULT_SOURCE_BYTES, sourceInteger, validEtag } from "./source-policy.js";
import { waitForSnapshotOperation } from "./abortable.js";
import { RefreshOperation } from "./refresh-operation.js";
import { failureCause, retainFailureCause } from "./failure-cause.js";

interface CommittedSource {
  readonly snapshotHash: string;
  readonly etag: string | undefined;
  readonly provenance: SignedSnapshotMetadata | undefined;
  readonly artifact: Uint8Array | undefined;
}

interface DurableRefresh {
  readonly store: SignedSnapshotStore;
  readonly verifier: SnapshotVerifier;
  readonly prepare: NonNullable<SnapshotRefresherOptions["provider"]["prepareSnapshot"]>;
}

export function createSnapshotRefresher(options: SnapshotRefresherOptions): SnapshotRefresher {
  const { provider, source, verifier, store } = options;
  const timeoutMs = sourceInteger("timeoutMs", options.timeoutMs ?? 30_000, 1, 2_147_483_647);
  if (options.onFailure !== undefined && typeof options.onFailure !== "function")
    throw new TypeError("onFailure must be a function.");
  const onFailure = options.onFailure?.bind(options);
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
  const durable =
    store !== undefined && verifier !== undefined && prepare !== undefined
      ? { store, verifier, prepare }
      : undefined;
  let committed: CommittedSource | undefined;
  let closed = false;
  let active: RefreshOperation | undefined;
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

  function diagnoseFailure(
    operation: RefreshOperation,
    kind: RefreshFailureKind,
    cause: unknown
  ): void {
    try {
      void Promise.resolve(
        onFailure?.({
          kind,
          cause: failureCause(cause),
          timedOut: operation.timeoutError !== undefined
        })
      ).catch(() => {});
    } catch {
      /* Operator diagnostics must not alter refresh results. */
    }
  }

  function reportFailure(
    operation: RefreshOperation,
    kind: RefreshFailureKind,
    cause: unknown
  ): void {
    if (operation.failureReported) {
      if (operation.timeoutError !== undefined && failureCause(cause) !== operation.timeoutError)
        diagnoseFailure(operation, kind, cause);
      return;
    }
    operation.failureReported = true;
    provider.reportRefreshFailure(kind);
    diagnoseFailure(operation, kind, cause);
  }

  async function persistAndActivate(
    operation: RefreshOperation,
    delivery: DurableRefresh,
    verified: VerifiedFlagSnapshot,
    signedBytes: Uint8Array,
    expectedHash: string
  ): Promise<void> {
    operation.assertNotTimedOut();
    const transaction = delivery.prepare(verified.snapshot, verified.provenance);
    try {
      if (closed || provider.getStatus().closed) throw unavailable("Snapshot refresher is closed.");
      try {
        const acknowledged = await operation.persist(() =>
          delivery.store.commit(Uint8Array.from(signedBytes))
        );
        if (!matchesVerifiedOrigin(acknowledged, verified, expectedHash)) throw new Error();
      } catch (cause) {
        reportFailure(operation, "persist", cause);
        throw unavailable("Snapshot persistence is unavailable.", cause);
      }
      // Acceptance is durable even if close or final freshness checks prevent activation.
      replayFloor = verified.provenance;
      operation.assertNotTimedOut();
      if (closed || provider.getStatus().closed)
        throw unavailable("Snapshot refresher is closed after persistence.");
      try {
        const fresh = delivery.verifier.verify(signedBytes, replayFloor);
        if (!matchesVerifiedOrigin(fresh, verified, expectedHash)) throw new Error();
      } catch (cause) {
        reportFailure(operation, "signature", cause);
        throw retainFailureCause(
          new LocalProviderError("SCHEMA_ERROR", "Signed snapshot verification failed."),
          cause
        );
      }
      operation.assertNotTimedOut();
      try {
        transaction.commit();
      } catch (cause) {
        reportFailure(operation, "load", cause);
        throw unavailable("Snapshot application failed after persistence.", cause);
      }
    } finally {
      transaction.cancel();
    }
  }

  async function performRefresh(operation: RefreshOperation): Promise<SnapshotRefreshResult> {
    if (closed || provider.getStatus().closed) throw unavailable("Snapshot refresher is closed.");
    const beforeStatus = provider.getStatus();
    const before = beforeStatus.snapshotHash;
    const beforeArtifact = beforeStatus.provenance?.artifactHash;
    const conditionalEtag =
      committed?.snapshotHash === before && committed.provenance?.artifactHash === beforeArtifact
        ? committed.etag
        : undefined;
    operation.assertNotTimedOut();
    const signal = operation.signal;
    try {
      if (store !== undefined) {
        try {
          const recovery = await operation.read(() => store.load({ signal }));
          replayFloor = mergeFloor(replayFloor, recovery?.floor);
        } catch (cause) {
          if (closed) throw unavailable("Snapshot refresher is closed.", cause);
          operation.assertNotTimedOut();
          reportFailure(operation, "persist", cause);
          throw unavailable("Snapshot persistence is unavailable.", cause);
        }
        if (closed || provider.getStatus().closed)
          throw unavailable("Snapshot refresher is closed.");
        const loaded = provider.getStatus();
        if (loaded.snapshotHash !== before || loaded.provenance?.artifactHash !== beforeArtifact) {
          reportFailure(operation, "load", new Error("Snapshot changed during recovery."));
          throw unavailable("Snapshot changed during recovery; retry explicitly.");
        }
      }
      let response: SnapshotSourceResponse;
      try {
        operation.stage = "fetch";
        response = await operation.read(() =>
          source.fetch({
            signal,
            ...(conditionalEtag !== undefined ? { etag: conditionalEtag } : {})
          })
        );
      } catch (cause) {
        if (closed) throw unavailable("Snapshot refresher is closed.", cause);
        operation.assertNotTimedOut();
        if (!closed && !provider.getStatus().closed) reportFailure(operation, "fetch", cause);
        throw unavailable("Snapshot source could not be refreshed.", cause);
      }
      if (closed || provider.getStatus().closed) throw unavailable("Snapshot refresher is closed.");
      const current = provider.getStatus();
      if (current.snapshotHash !== before || current.provenance?.artifactHash !== beforeArtifact) {
        reportFailure(operation, "load", new Error("Snapshot changed during refresh."));
        throw unavailable("Snapshot changed during refresh; retry explicitly.");
      }
      operation.stage = "validation";
      let artifact: Uint8Array | undefined;
      try {
        response = captureSourceResponse(response);
        artifact = captureSourceArtifact(
          response,
          maxBytes,
          conditionalEtag,
          verifier !== undefined
        );
      } catch (cause) {
        reportFailure(operation, "validation", cause);
        throw retainFailureCause(
          new LocalProviderError("SCHEMA_ERROR", "Snapshot source content is invalid."),
          cause
        );
      }
      let snapshot: FlagSnapshot;
      let verified: VerifiedFlagSnapshot | undefined;
      if (verifier !== undefined) {
        operation.stage = "signature";
        try {
          const signedBytes = artifact ?? committed?.artifact;
          if (signedBytes === undefined) throw new Error("No signed artifact.");
          replayFloor = mergeFloor(replayFloor, beforeStatus.provenance);
          verified = verifier.verify(signedBytes, replayFloor);
          snapshot = verified.snapshot;
        } catch (cause) {
          reportFailure(operation, "signature", cause);
          throw retainFailureCause(
            new LocalProviderError("SCHEMA_ERROR", "Signed snapshot verification failed."),
            cause
          );
        }
      } else {
        try {
          snapshot =
            artifact === undefined ? provider.getSnapshot() : parseSourceSnapshot(artifact, format);
        } catch (cause) {
          reportFailure(operation, "validation", cause);
          throw retainFailureCause(
            new LocalProviderError("SCHEMA_ERROR", "Snapshot source content is invalid."),
            cause
          );
        }
      }
      // Provider validation failures are already counted there. Commit the validator
      // only after application succeeds; failures leave both snapshot and ETag intact.
      operation.assertNotTimedOut();
      const expectedHash = createSnapshotHash(snapshot);
      operation.assertNotTimedOut();
      operation.stage = "load";
      if (durable !== undefined && verified !== undefined) {
        const signedBytes = artifact ?? committed?.artifact;
        if (signedBytes === undefined) throw unavailable("No signed artifact is available.");
        await persistAndActivate(operation, durable, verified, signedBytes, expectedHash);
      } else {
        provider.updateSnapshot(snapshot, verified?.provenance);
      }
      const applied = provider.getStatus();
      const snapshotHash = applied.snapshotHash;
      if (
        snapshotHash !== expectedHash ||
        applied.provenance?.artifactHash !== verified?.provenance.artifactHash
      ) {
        reportFailure(operation, "load", new Error("Snapshot changed during application."));
        throw unavailable("Snapshot changed during application; retry explicitly.");
      }
      if (verified !== undefined) replayFloor = verified.provenance;
      committed = {
        snapshotHash,
        etag: response.status === "content" ? response.etag : committed?.etag,
        provenance: verified?.provenance,
        artifact: verified === undefined ? undefined : (artifact ?? committed?.artifact)
      };
      return {
        status: snapshotHash === before ? "unchanged" : "updated",
        snapshotHash,
        ...(committed.provenance !== undefined ? { provenance: committed.provenance } : {})
      };
    } catch (cause) {
      if (!closed && !provider.getStatus().closed && !operation.failureReported) {
        operation.failureReported = true;
        // Native provider preparation/application already counts its own failures.
        diagnoseFailure(operation, operation.stage, cause);
      }
      throw cause;
    }
  }

  return {
    getProvenance() {
      const status = provider.getStatus();
      return status.snapshotHash === committed?.snapshotHash &&
        status.provenance?.artifactHash === committed.provenance?.artifactHash
        ? committed.provenance
        : undefined;
    },
    refresh(request = {}) {
      if (closed || provider.getStatus().closed)
        return Promise.reject(unavailable("Snapshot refresher is closed."));
      const signal = request.signal;
      if (signal?.aborted)
        return Promise.reject(unavailable("Snapshot refresh wait was cancelled.", signal.reason));
      if (inFlight === undefined) {
        const operation = new RefreshOperation(
          timeoutMs,
          store === undefined ? "fetch" : "persist"
        );
        active = operation;
        inFlight = operation.run(
          () => performRefresh(operation),
          (error) => reportFailure(operation, operation.stage, error),
          () => {
            if (active === operation) {
              active = undefined;
              inFlight = undefined;
            }
          }
        );
      }
      const shared = inFlight;
      return signal === undefined
        ? shared
        : waitForSnapshotOperation(() => shared, signal, "Snapshot refresh wait was cancelled.");
    },
    close() {
      closed = true;
      active?.abort();
    }
  };
}

// Detach cache metadata before verifier callbacks, persistence or provider events.
function captureSourceResponse(response: SnapshotSourceResponse): SnapshotSourceResponse {
  const status = response.status;
  if (status === "notModified") return { status };
  if (status !== "content") throw new Error("Unknown source response.");
  const { content, etag } = response;
  return {
    status,
    content,
    ...(typeof etag === "string" && validEtag(etag) ? { etag } : {})
  };
}

function captureSourceArtifact(
  response: SnapshotSourceResponse,
  maxBytes: number,
  conditionalEtag: string | undefined,
  signed: boolean
): Uint8Array | undefined {
  if (response.status === "notModified") {
    if (conditionalEtag === undefined) throw new Error("Unexpected not-modified response.");
    return undefined;
  }
  if (response.content.byteLength > maxBytes) throw new Error("Snapshot exceeds maxBytes.");
  return signed ? Uint8Array.from(response.content) : response.content;
}

function parseSourceSnapshot(artifact: Uint8Array, format: "json" | "yaml"): FlagSnapshot {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact);
  return format === "json" ? parseJsonFlagSnapshot(text) : parseYamlFlagSnapshot(text);
}

function matchesVerifiedOrigin(
  actual: VerifiedFlagSnapshot,
  expected: VerifiedFlagSnapshot,
  snapshotHash: string
): boolean {
  return (
    actual.provenance.artifactHash === expected.provenance.artifactHash &&
    actual.provenance.snapshotHash === snapshotHash
  );
}

function unavailable(message: string, cause?: unknown): LocalProviderError {
  return retainFailureCause(new LocalProviderError("PROVIDER_NOT_READY", message), cause);
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
