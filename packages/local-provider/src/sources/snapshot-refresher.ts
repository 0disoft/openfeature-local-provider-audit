import { LocalProviderError } from "../errors/local-provider-error.js";
import { createSnapshotHash } from "../audit/audit-event.js";
import { parseJsonFlagSnapshot } from "../flags/parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "../flags/parse-yaml-snapshot.js";
import type {
  FlagSnapshot,
  SnapshotRefresher,
  SnapshotRefresherOptions,
  SnapshotRefreshResult,
  SnapshotSourceResponse
} from "../public-types.js";
import { DEFAULT_SOURCE_BYTES, sourceInteger } from "./https-source.js";

export function createSnapshotRefresher(options: SnapshotRefresherOptions): SnapshotRefresher {
  const { provider, source } = options;
  const format = options.format ?? "json";
  if (format !== "json" && format !== "yaml")
    throw new TypeError("Snapshot format must be json or yaml.");
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
      let snapshot: FlagSnapshot;
      try {
        if (response.status === "notModified") {
          if (conditionalEtag === undefined) throw new Error("Unexpected not-modified response.");
          snapshot = provider.getSnapshot();
        } else if (response.status === "content") {
          if (response.content.byteLength > maxBytes) throw new Error("Snapshot exceeds maxBytes.");
          const text = new TextDecoder("utf-8", { fatal: true }).decode(response.content);
          snapshot = format === "json" ? parseJsonFlagSnapshot(text) : parseYamlFlagSnapshot(text);
        } else {
          throw new Error("Unknown source response.");
        }
      } catch {
        provider.reportRefreshFailure("validation");
        throw new LocalProviderError("SCHEMA_ERROR", "Snapshot source content is invalid.");
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
      if (response.status === "content") etag = response.etag;
      return { status: snapshotHash === before ? "unchanged" : "updated", snapshotHash };
    } finally {
      active = undefined;
    }
  }

  return {
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
