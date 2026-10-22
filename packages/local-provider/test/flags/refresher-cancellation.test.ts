import { expect, it, vi } from "vitest";
import {
  createReloadableLocalProvider,
  createSnapshotRefresher,
  type SnapshotSource,
  type SnapshotSourceResponse
} from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("does not fetch for an already cancelled waiter or a closed refresher", async () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const fetch = vi.fn<SnapshotSource["fetch"]>();
  const refresher = createSnapshotRefresher({ provider, source: { fetch } });
  await expect(refresher.refresh({ signal: AbortSignal.abort() })).rejects.toThrow("cancelled");
  refresher.close();
  await expect(refresher.refresh()).rejects.toThrow("closed");
  expect(fetch).not.toHaveBeenCalled();
  expect(provider.getStatus().failedRefreshes).toBe(0);
});

it("cancels only the caller's wait while preserving one shared refresh", async () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const pending = deferred<SnapshotSourceResponse>();
  const fetch = vi.fn<SnapshotSource["fetch"]>(() => pending.promise);
  const refresher = createSnapshotRefresher({ provider, source: { fetch } });
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, "removeEventListener");
  const cancelled = refresher.refresh({ signal: caller.signal });
  const shared = refresher.refresh();
  expect(refresher.refresh()).toBe(shared);
  const rejected = expect(cancelled).rejects.toThrow("cancelled");
  await Promise.resolve();
  caller.abort();
  await rejected;
  expect(fetch.mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
  pending.resolve({ status: "content", content: Buffer.from('{"schemaVersion":1,"flags":{}}') });
  await expect(shared).resolves.toMatchObject({ status: "updated" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(provider.getSnapshot().flags).toEqual({});
  expect(provider.getStatus().failedRefreshes).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  remove.mockRestore();
  refresher.close();
});

it.each(["resolve", "reject"] as const)(
  "finishes close before an abort-ignoring source's late %s",
  async (settlement) => {
    const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
    const pending = deferred<SnapshotSourceResponse>();
    const fetch = vi.fn<SnapshotSource["fetch"]>(() => pending.promise);
    const refresher = createSnapshotRefresher({ provider, source: { fetch } });
    const waiting = refresher.refresh();
    const rejected = expect(waiting).rejects.toThrow("closed");
    await Promise.resolve();
    refresher.close();
    await rejected;
    await expect(refresher.refresh()).rejects.toThrow("closed");
    expect(fetch.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    if (settlement === "resolve") {
      pending.resolve({
        status: "content",
        content: Buffer.from('{"schemaVersion":1,"flags":{}}')
      });
    } else {
      pending.reject(new Error("late private source failure"));
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.getSnapshot()).toEqual(staticSnapshot);
    expect(provider.getStatus()).toMatchObject({ failedRefreshes: 0, successfulRefreshes: 1 });
  }
);

it("stops waiting for recovery on close without fetching or starting persistence", async () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const recovery = deferred<undefined>();
  const started = deferred<void>();
  const fetch = vi.fn<SnapshotSource["fetch"]>();
  const commit = vi.fn();
  const refresher = createSnapshotRefresher({
    provider,
    source: { fetch },
    verifier: { verify: vi.fn() },
    store: {
      load: () => {
        started.resolve();
        return recovery.promise;
      },
      commit
    }
  });
  const waiting = refresher.refresh();
  const rejected = expect(waiting).rejects.toThrow("closed");
  await started.promise;
  refresher.close();
  await rejected;
  recovery.resolve(undefined);
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(provider.getStatus().failedRefreshes).toBe(0);
});
