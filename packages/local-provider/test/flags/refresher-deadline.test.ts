import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createReloadableLocalProvider,
  createSnapshotRefresher,
  createSnapshotVerifier,
  createS3SnapshotSource,
  signFlagSnapshot,
  type SnapshotSourceResponse,
  type SnapshotRecovery,
  type VerifiedFlagSnapshot,
  type SnapshotRefresherOptions
} from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";
import { waitForSnapshotOperation } from "../../src/sources/abortable.js";
import { failureCause } from "../../src/sources/failure-cause.js";

const bootstrap = { schemaVersion: 1 as const, flags: {} };
function provider() {
  return createReloadableLocalProvider({ snapshot: bootstrap, env: {} });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fakeTime() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
}
function signed(snapshot = staticSnapshot) {
  const keys = generateKeyPairSync("ed25519");
  const now = Date.now();
  const options = {
    snapshot,
    privateKey: keys.privateKey,
    keyId: "test",
    audience: "deadline",
    sequence: 1,
    issuedAt: now - 1000,
    expiresAt: now + 60_000
  };
  const artifact = signFlagSnapshot(options);
  const verifier = createSnapshotVerifier({
    trustedKeys: { test: keys.publicKey },
    audience: "deadline"
  });
  const verified = verifier.verify(Buffer.from(artifact));
  const conflict = signFlagSnapshot({ ...options, snapshot: bootstrap });
  return { artifact, conflict, verifier, verified };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("bounds custom reads and keeps one owner until the actual ignored read settles", async () => {
  fakeTime();
  const target = provider(),
    pending = deferred<SnapshotSourceResponse>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ status: "content", content: Buffer.from(JSON.stringify(staticSnapshot)) });
  const onFailure = vi.fn();
  const refresher = createSnapshotRefresher({
    provider: target,
    source: { fetch },
    timeoutMs: 25,
    onFailure
  });
  const running = refresher.refresh();
  const rejected = expect(running).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(25);
  await rejected;
  expect(refresher.refresh()).toBe(running);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]?.signal.aborted).toBe(true);
  expect(target.getStatus().failedRefreshes).toBe(1);
  expect(onFailure).toHaveBeenCalledOnce();
  pending.resolve({ status: "content", content: Buffer.from(JSON.stringify(staticSnapshot)) });
  await vi.advanceTimersByTimeAsync(0);
  expect(target.getSnapshot()).toEqual(bootstrap);
  await expect(refresher.refresh()).resolves.toMatchObject({ status: "updated" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  refresher.close();
});

it("passes a cancellable recovery signal and never fetches after a recovery deadline", async () => {
  fakeTime();
  const pending = deferred<SnapshotRecovery | undefined>();
  let recoverySignal: AbortSignal | undefined;
  const fetch = vi.fn(),
    commit = vi.fn();
  const onFailure = vi.fn();
  const refresher = createSnapshotRefresher({
    provider: provider(),
    source: { fetch },
    verifier: signed().verifier,
    timeoutMs: 25,
    onFailure,
    store: {
      load: (request) => {
        recoverySignal = request?.signal;
        return pending.promise;
      },
      commit
    }
  });
  const running = refresher.refresh(),
    rejected = expect(running).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(25);
  await rejected;
  expect(recoverySignal?.aborted).toBe(true);
  expect(refresher.refresh()).toBe(running);
  expect(onFailure).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "persist", timedOut: true })
  );
  pending.resolve(undefined);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  refresher.close();
});

it.each(["accept", "fail"] as const)(
  "bounds commit waiting, retaining reservations until late %s",
  async (outcome) => {
    fakeTime();
    const target = provider(),
      fixture = signed();
    const pending = deferred<VerifiedFlagSnapshot>(),
      started = deferred<void>();
    const commit = vi.fn(() => {
      started.resolve();
      return pending.promise;
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: "content",
        content: Buffer.from(fixture.artifact),
        etag: '"not-committed"'
      })
      .mockResolvedValue({ status: "content", content: Buffer.from(fixture.conflict) });
    const onFailure = vi.fn();
    const refresher = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: fixture.verifier,
      store: { load: async () => undefined, commit },
      timeoutMs: 25,
      onFailure
    });
    const running = refresher.refresh(),
      rejected = expect(running).rejects.toThrow("persistence outcome is unknown");
    await started.promise;
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(() => target.updateSnapshot(bootstrap)).toThrow("pending persistence");
    expect(refresher.refresh()).toBe(running);
    expect(commit).toHaveBeenCalledOnce();
    const failure = new Error("private commit cause");
    const failuresBeforeSettlement = target.getStatus().failedRefreshes;
    if (outcome === "accept") pending.resolve(fixture.verified);
    else pending.reject(failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(target.getSnapshot()).toEqual(bootstrap);
    expect(refresher.getProvenance()).toBeUndefined();
    expect(target.getStatus().failedRefreshes).toBe(failuresBeforeSettlement);
    target.updateSnapshot(bootstrap);
    if (outcome === "accept") {
      await expect(refresher.refresh()).rejects.toThrow("verification failed");
      expect(commit).toHaveBeenCalledOnce(); // The accepted replay floor survives the deadline.
      expect(fetch.mock.calls[1]?.[0]?.etag).toBeUndefined();
    } else {
      expect(onFailure).toHaveBeenLastCalledWith({
        kind: "persist",
        timedOut: true,
        cause: failure
      });
    }
    expect(vi.getTimerCount()).toBe(0);
    refresher.close();
  }
);

it.each(["throw", "reject"] as const)(
  "isolates diagnostic %s while exposing original SDK causes only to the operator",
  async (mode) => {
    const cause = Object.assign(new Error("private endpoint/token"), { code: "ECONNRESET" });
    const source = createS3SnapshotSource({
      client: {
        getObject: async () => {
          throw cause;
        }
      },
      bucket: "test",
      key: "flags",
      maxAttempts: 1
    });
    const onFailure = vi.fn(function (this: SnapshotRefresherOptions, failure: unknown) {
      expect(this).toBe(options);
      expect(failure).toEqual({ kind: "fetch", cause, timedOut: false });
      if (mode === "reject") return Promise.reject(new Error("diagnostic failed"));
      throw new Error("diagnostic failed");
    });
    const options: SnapshotRefresherOptions = { provider: provider(), source, onFailure };
    const refresher = createSnapshotRefresher(options);
    const error = await refresher.refresh().catch((error) => error);
    expect(error.code).toBe("PROVIDER_NOT_READY");
    expect(error.message).toBe("Snapshot source could not be refreshed.");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("private");
    expect(onFailure).toHaveBeenCalledOnce();
    expect(options.provider.getStatus().failedRefreshes).toBe(1);
    refresher.close();
  }
);

it("defaults to a 30 second refresh deadline and clears its timer after close", async () => {
  fakeTime();
  const refresher = createSnapshotRefresher({
    provider: provider(),
    source: { fetch: () => new Promise(() => {}) }
  });
  const running = refresher.refresh();
  const rejected = expect(running).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(29_999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  refresher.close();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([24, 25, 26])(
  "checks elapsed verification time at %s ms without timer dispatch",
  async (elapsed) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const target = provider(),
      fixture = signed();
    const onFailure = vi.fn();
    const refresher = createSnapshotRefresher({
      provider: target,
      timeoutMs: 25,
      onFailure,
      source: {
        fetch: async () => ({ status: "content", content: Buffer.from(fixture.artifact) })
      },
      verifier: {
        verify(bytes, previous) {
          const result = fixture.verifier.verify(bytes, previous);
          clock.mockReturnValue(elapsed);
          return result;
        }
      }
    });
    if (elapsed < 25) {
      await expect(refresher.refresh()).resolves.toMatchObject({ status: "updated" });
      expect(onFailure).not.toHaveBeenCalled();
    } else {
      await expect(refresher.refresh()).rejects.toThrow("timed out");
      expect(target.getSnapshot()).toEqual(bootstrap);
      expect(onFailure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind: "signature",
          timedOut: true
        })
      );
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    refresher.close();
  }
);

it("does not enter verification after a synchronous source consumes the deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const target = provider(),
    fixture = signed(),
    verify = vi.fn();
  const refresher = createSnapshotRefresher({
    provider: target,
    timeoutMs: 25,
    verifier: { verify },
    source: {
      fetch: async () => {
        clock.mockReturnValue(25);
        return { status: "content", content: Buffer.from(fixture.artifact) };
      }
    }
  });
  await expect(refresher.refresh()).rejects.toThrow("timed out");
  expect(verify).not.toHaveBeenCalled();
  expect(target.getSnapshot()).toEqual(bootstrap);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  refresher.close();
});

it("preserves intentional close between read completion and its budget check", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const target = provider(),
    pending = deferred<SnapshotSourceResponse>(),
    onFailure = vi.fn();
  const refresher = createSnapshotRefresher({
    provider: target,
    timeoutMs: 25,
    onFailure,
    source: { fetch: () => pending.promise }
  });
  const running = refresher.refresh();
  await Promise.resolve();
  pending.resolve({ status: "content", content: Buffer.from(JSON.stringify(staticSnapshot)) });
  queueMicrotask(() => {
    clock.mockReturnValue(25);
    refresher.close();
  });
  await expect(running).rejects.toThrow("closed");
  expect(onFailure).not.toHaveBeenCalled();
  expect(target.getStatus().failedRefreshes).toBe(0);
  expect(target.getSnapshot()).toEqual(bootstrap);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps durable acceptance without activation when final verification consumes the deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const target = provider(),
    fixture = signed();
  const commit = vi.fn().mockResolvedValue(fixture.verified);
  let verifications = 0;
  const refresher = createSnapshotRefresher({
    provider: target,
    timeoutMs: 25,
    source: { fetch: async () => ({ status: "content", content: Buffer.from(fixture.artifact) }) },
    verifier: {
      verify(bytes, previous) {
        const result = fixture.verifier.verify(bytes, previous);
        if (++verifications === 2) clock.mockReturnValue(25);
        return result;
      }
    },
    store: { load: async () => undefined, commit }
  });
  await expect(refresher.refresh()).rejects.toThrow("timed out");
  expect(commit).toHaveBeenCalledOnce();
  expect(target.getSnapshot()).toEqual(bootstrap);
  expect(refresher.getProvenance()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);
  expect(() => target.updateSnapshot(bootstrap)).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
  refresher.close();
});

it("retains cancellation reasons privately without exposing a public cause", async () => {
  const controller = new AbortController(),
    reason = new Error("private cancel reason");
  const waiting = waitForSnapshotOperation(
    () => new Promise(() => {}),
    controller.signal,
    "cancelled"
  );
  controller.abort(reason);
  const error = await waiting.catch((error) => error);
  expect(failureCause(error)).toBe(reason);
  expect(error).toBeInstanceOf(Error);
  expect(error).toHaveProperty("message", "cancelled");
  expect(error).not.toHaveProperty("cause");
});

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
  "rejects invalid refresh deadline %s",
  (timeoutMs) => {
    expect(() =>
      createSnapshotRefresher({ provider: provider(), source: { fetch: vi.fn() }, timeoutMs })
    ).toThrow(RangeError);
  }
);
