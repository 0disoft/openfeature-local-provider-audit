import { LocalProviderError } from "../errors/local-provider-error.js";
import { cleanupResource } from "../errors/resource-cleanup.js";
import { validateFlagSnapshot } from "../flags/validate-snapshot.js";
import type {
  ManagedLocalProvider,
  ManagedLocalProviderOptions,
  SignedSnapshotStore,
  SnapshotRefresher
} from "../public-types.js";
import { waitForSnapshotOperation } from "../sources/abortable.js";
import { retainFailureCause } from "../sources/failure-cause.js";
import { createSnapshotVerifier } from "../sources/signed-snapshot.js";
import { createSnapshotRefresher } from "../sources/snapshot-refresher.js";
import { createFileSnapshotStore } from "../sources/snapshot-store.js";
import { sourceInteger } from "../sources/source-policy.js";
import { createReloadableLocalProvider } from "./local-provider.js";

export async function createManagedLocalProvider(
  options: ManagedLocalProviderOptions
): Promise<ManagedLocalProvider> {
  const { source, signal, allowFirstStart } = options;
  const intervalMs = sourceInteger(
    "refreshIntervalMs",
    options.refreshIntervalMs ?? 30_000,
    1,
    2_147_483_647
  );
  const refreshOptions = { ...options.refresh };
  const timeoutMs = sourceInteger(
    "timeoutMs",
    refreshOptions.timeoutMs ?? 30_000,
    1,
    2_147_483_647
  );
  const providerOptions = {
    ...options.provider,
    env: { ...(options.provider?.env ?? {}) },
    auditRedaction: { contextKeys: options.provider?.auditRedaction?.contextKeys ?? "none" }
  };
  const bootstrap = validateFlagSnapshot(options.bootstrap);
  const verifier = createSnapshotVerifier(options.verification);
  const store = createFileSnapshotStore({
    ...options.recovery,
    verification: options.verification
  });
  const recovered = await loadRecovery(store, timeoutMs, signal);
  if (signal?.aborted)
    throw new LocalProviderError("PROVIDER_NOT_READY", "Managed provider startup cancelled.");
  if (recovered === undefined && allowFirstStart !== true)
    throw new LocalProviderError(
      "PROVIDER_NOT_READY",
      "Recovery state is missing; authorize first startup explicitly."
    );
  const provider = createReloadableLocalProvider({
    ...providerOptions,
    snapshot: recovered?.current?.snapshot ?? bootstrap,
    ...(recovered?.current !== undefined ? { provenance: recovered.current.provenance } : {})
  });
  let refresher: SnapshotRefresher;
  try {
    refresher = createSnapshotRefresher({
      ...refreshOptions,
      provider,
      source,
      store,
      verifier,
      ...(recovered !== undefined ? { previous: recovered.floor } : {})
    });
  } catch (cause) {
    await cleanupResource(
      async () => {
        await provider.onClose?.();
      },
      { cause },
      "Managed provider setup and cleanup failed."
    );
    throw cause;
  }
  const ownedRefresher = refresher;
  const shutdownProvider = provider.onClose?.bind(provider);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let closing = false;
  let closeOperation: Promise<void> | undefined;

  function schedule(): void {
    if (closing || provider.getStatus().closed) return;
    timer = setTimeout(poll, intervalMs);
    timer.unref();
  }
  function poll(): void {
    timer = undefined;
    if (closing || provider.getStatus().closed) return;
    // The refresher records failures and invokes onFailure; both outcomes reschedule.
    void ownedRefresher.refresh().then(schedule, schedule);
  }
  function close(): Promise<void> {
    if (closeOperation !== undefined) return closeOperation;
    closing = true;
    if (timer !== undefined) clearTimeout(timer);
    // Publish the shared result before abort callbacks can reenter close().
    closeOperation = Promise.resolve().then(() => shutdownProvider?.());
    ownedRefresher.close();
    return closeOperation;
  }
  // SDK shutdown and controller shutdown share the same owned lifecycle.
  provider.onClose = close;
  return Object.freeze({
    provider,
    store,
    refresh: ownedRefresher.refresh.bind(ownedRefresher),
    getStatus: provider.getStatus.bind(provider),
    start() {
      if (closing || provider.getStatus().closed)
        throw new LocalProviderError("PROVIDER_NOT_READY", "Managed provider is closed.");
      if (started) return;
      started = true;
      poll();
    },
    close
  });
}

async function loadRecovery(store: SignedSnapshotStore, timeoutMs: number, signal?: AbortSignal) {
  const abort = new AbortController();
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const deadlineTick = performance.now() + timeoutMs;
  const expire = () => abort.abort(new Error("Recovery load timed out."));
  const timer = setTimeout(expire, timeoutMs);
  timer.unref();
  if (signal?.aborted) onAbort();
  const message = "Managed provider recovery load cancelled or timed out.";
  try {
    const recovered = await waitForSnapshotOperation(
      () => store.load({ signal: abort.signal }),
      abort.signal,
      message
    );
    // Synchronous authentication can finish after expiry before its timer runs.
    if (performance.now() >= deadlineTick) {
      expire();
      throw retainFailureCause(
        new LocalProviderError("PROVIDER_NOT_READY", message),
        abort.signal.reason
      );
    }
    return recovered;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
