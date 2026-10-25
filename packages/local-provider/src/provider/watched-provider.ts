import { isLocalProviderError, LocalProviderError } from "../errors/local-provider-error.js";
import { cleanupResource } from "../errors/resource-cleanup.js";
import { watchFlagSnapshotFile } from "../flags/snapshot-file.js";
import type {
  FlagSnapshot,
  FlagSnapshotFileWatcher,
  ReloadableLocalProvider,
  WatchedLocalProvider,
  WatchedLocalProviderOptions
} from "../public-types.js";
import { createReloadableLocalProvider } from "./local-provider.js";

export async function createWatchedLocalProvider(
  options: WatchedLocalProviderOptions
): Promise<WatchedLocalProvider> {
  const { provider: inputProvider, onFailure, ...watchOptions } = options;
  if (onFailure !== undefined && typeof onFailure !== "function")
    throw new TypeError("onFailure must be a function.");
  if (inputProvider !== undefined && "provenance" in inputProvider)
    throw new TypeError("Unsigned file delivery cannot seed signed provenance.");
  const providerOptions = {
    ...inputProvider,
    env: { ...(inputProvider?.env ?? {}) },
    auditRedaction: { contextKeys: inputProvider?.auditRedaction?.contextKeys ?? "none" }
  };
  let provider: ReloadableLocalProvider | undefined;
  let closing = false;
  const applicationFailures = new WeakMap<object, "load" | "validation">();
  const observed = new WeakSet<object>();

  function observeFailure(cause: unknown): void {
    const reference =
      cause !== null && (typeof cause === "object" || typeof cause === "function")
        ? cause
        : undefined;
    if (reference !== undefined && observed.has(reference)) return;
    if (reference !== undefined) observed.add(reference);
    const applicationKind =
      reference === undefined ? undefined : applicationFailures.get(reference);
    if (reference !== undefined) applicationFailures.delete(reference);
    const kind = applicationKind ?? "load";
    if (applicationKind === undefined) provider?.reportRefreshFailure(kind);
    try {
      void Promise.resolve(onFailure?.({ kind, cause })).catch(() => {});
    } catch {
      /* Optional diagnostics cannot alter file delivery. */
    }
  }

  let watcher: FlagSnapshotFileWatcher;
  try {
    watcher = await watchFlagSnapshotFile({
      ...watchOptions,
      onSnapshot(snapshot) {
        if (closing) return;
        if (provider === undefined) {
          provider = createReloadableLocalProvider({ ...providerOptions, snapshot });
          return;
        }
        try {
          provider.updateSnapshot(snapshot);
        } catch (cause) {
          if (cause !== null && (typeof cause === "object" || typeof cause === "function"))
            applicationFailures.set(
              cause,
              isLocalProviderError(cause) && cause.code === "SCHEMA_ERROR" ? "validation" : "load"
            );
          // Keep watcher acceptance aligned with provider acceptance, enabling retries.
          throw cause;
        }
      },
      onError(cause) {
        if (closing) return;
        // Each native notification is a new attempt; its manual waiter runs later.
        if (cause !== null && (typeof cause === "object" || typeof cause === "function"))
          observed.delete(cause);
        observeFailure(cause);
      }
    });
  } catch (cause) {
    observeFailure(cause);
    await cleanupResource(
      async () => {
        await provider?.onClose?.();
      },
      { cause },
      "Watched provider setup and cleanup failed."
    );
    throw cause;
  }
  if (provider === undefined) {
    watcher.close();
    throw new LocalProviderError(
      "PROVIDER_NOT_READY",
      "Snapshot watcher supplied no initial snapshot."
    );
  }
  const ownedProvider = provider;
  const shutdownProvider = ownedProvider.onClose?.bind(ownedProvider);
  let closeOperation: Promise<void> | undefined;
  let reloading: Promise<FlagSnapshot> | undefined;
  function close(): Promise<void> {
    if (closeOperation !== undefined) return closeOperation;
    closing = true;
    let failure: { cause: unknown } | undefined;
    // Reserve the result before synchronous watcher cleanup can reenter close().
    closeOperation = Promise.resolve().then(async () => {
      await cleanupResource(
        async () => {
          await shutdownProvider?.();
        },
        failure,
        "Watcher release and provider shutdown failed."
      );
      if (failure !== undefined) throw failure.cause;
    });
    try {
      watcher.close();
    } catch (cause) {
      failure = { cause };
    }
    return closeOperation;
  }
  ownedProvider.onClose = close;
  return Object.freeze({
    provider: ownedProvider,
    getStatus: ownedProvider.getStatus.bind(ownedProvider),
    reload() {
      if (closing)
        return Promise.reject(
          new LocalProviderError("PROVIDER_NOT_READY", "Watched provider is closed.")
        );
      if (reloading !== undefined) return reloading;
      reloading = Promise.resolve()
        .then(() => watcher.reload())
        .then(
          (snapshot) => {
            reloading = undefined;
            if (closing)
              throw new LocalProviderError("PROVIDER_NOT_READY", "Watched provider is closed.");
            return snapshot;
          },
          (cause: unknown) => {
            // Clear before diagnostics, so a recovery callback can request a new read.
            reloading = undefined;
            if (!closing) observeFailure(cause);
            if (cause !== null && (typeof cause === "object" || typeof cause === "function"))
              observed.delete(cause);
            throw cause;
          }
        );
      return reloading;
    },
    close
  });
}
