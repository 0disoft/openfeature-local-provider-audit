import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createManagedLocalProvider,
  createFileSnapshotStore,
  signFlagSnapshot,
  type ManagedLocalProvider,
  type ManagedLocalProviderOptions,
  type SnapshotSource,
  type SnapshotSourceResponse
} from "../../src/index.js";
import * as snapshotStores from "../../src/sources/snapshot-store.js";
import { staticSnapshot } from "../fixtures.js";

const keys = generateKeyPairSync("ed25519");
const verification = { audience: "managed/test", trustedKeys: { release: keys.publicKey } };
const logger = { debug() {}, info() {}, warn() {}, error() {} };
let directory: string;
const runtimes: ManagedLocalProvider[] = [];
function options(source: SnapshotSource): ManagedLocalProviderOptions {
  return {
    source,
    verification,
    recovery: { path: join(directory, "state.json") },
    bootstrap: staticSnapshot,
    allowFirstStart: true,
    refreshIntervalMs: 100
  };
}
async function runtime(input: ManagedLocalProviderOptions) {
  const managed = await createManagedLocalProvider(input);
  runtimes.push(managed);
  return managed;
}
function token(sequence = 1) {
  return Buffer.from(
    signFlagSnapshot({
      snapshot: staticSnapshot,
      privateKey: keys.privateKey,
      keyId: "release",
      audience: verification.audience,
      sequence,
      issuedAt: Date.now() - 1000,
      expiresAt: Date.now() + 360_000
    })
  );
}
function source() {
  return {
    fetch: vi.fn<SnapshotSource["fetch"]>().mockImplementation(async () => ({
      status: "content",
      content: token(),
      etag: '"one"'
    }))
  };
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-managed-"));
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((managed) => managed.close().catch(() => {})));
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-managed-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

it("requires explicit first startup authorization, without fetching or binding a provider", async () => {
  const input = source();
  const bindStatus = vi.fn();
  await expect(
    createManagedLocalProvider({
      ...options(input),
      allowFirstStart: false,
      provider: { metrics: { bindStatus } }
    })
  ).rejects.toThrow("Recovery state is missing");
  expect(input.fetch).not.toHaveBeenCalled();
  expect(bindStatus).not.toHaveBeenCalled();
});

it("defaults to no ambient env and restores without a network fetch", async () => {
  vi.stubEnv("OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED", "false");
  try {
    const input = source();
    const managed = await runtime(options(input));
    expect(input.fetch).not.toHaveBeenCalled();
    expect(
      (await managed.provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)).value
    ).toBe(true);
    await expect(managed.refresh()).resolves.toMatchObject({ status: "unchanged" });
    expect(managed.getStatus().provenance?.sequence).toBe(1);
    await managed.close();
    const restarted = await runtime({ ...options(input), allowFirstStart: false });
    expect(restarted.getStatus().provenance?.sequence).toBe(1);
    expect(input.fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("retains the signed high-water mark even when recovered content has expired", async () => {
  const store = createFileSnapshotStore({ path: join(directory, "state.json"), verification });
  await store.commit(token(5));
  const future = Date.now() + 400_000;
  vi.spyOn(Date, "now").mockReturnValue(future);
  const input = source();
  const managed = await runtime(options(input));
  expect(managed.getStatus().provenance).toBeUndefined();
  await expect(managed.refresh()).rejects.toThrow("Signed snapshot verification failed");
  expect(managed.getStatus().snapshotHash).toBeDefined();
  expect((await managed.store.load())?.floor.sequence).toBe(5);
});

it("rejects corrupt recovery instead of silently bootstrapping", async () => {
  await writeFile(join(directory, "state.json"), "not json");
  const input = source();
  await expect(createManagedLocalProvider(options(input))).rejects.toThrow();
  expect(input.fetch).not.toHaveBeenCalled();
});

it("honors cancellation before startup and adds no polling until start is called", async () => {
  const input = source();
  await expect(
    createManagedLocalProvider({
      ...options(input),
      signal: AbortSignal.abort("stop")
    })
  ).rejects.toThrow("cancelled");
  vi.useFakeTimers();
  const managed = await runtime(options(input));
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(input.fetch).not.toHaveBeenCalled();
  await managed.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("polls sequentially and SDK shutdown cancels an abort-ignoring pending source", async () => {
  let signal: AbortSignal | undefined;
  let release!: (response: SnapshotSourceResponse) => void;
  const input = {
    fetch: vi.fn<SnapshotSource["fetch"]>((request) => {
      signal = request?.signal;
      return new Promise((done) => {
        release = done;
      });
    })
  };
  vi.useFakeTimers();
  const managed = await runtime(options(input));
  managed.start();
  managed.start();
  await vi.waitFor(() => expect(input.fetch).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(input.fetch).toHaveBeenCalledTimes(1);
  const waiting = managed.refresh();
  const failed = expect(waiting).rejects.toThrow("closed");
  const closing = managed.provider.onClose?.();
  expect(managed.close()).toBe(closing);
  await closing;
  await failed;
  expect(signal?.aborted).toBe(true);
  release({ status: "content", content: token(2) });
  await vi.advanceTimersByTimeAsync(1000);
  expect(managed.getStatus().closed).toBe(true);
  expect(managed.getStatus().provenance).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  expect(() => managed.start()).toThrow("closed");
});

it("reschedules after failure and keeps the cause available through refresh diagnostics", async () => {
  const failure = new Error("source unavailable");
  const input = { fetch: vi.fn<SnapshotSource["fetch"]>().mockRejectedValue(failure) };
  const onFailure = vi.fn();
  vi.useFakeTimers();
  const managed = await runtime({ ...options(input), refresh: { onFailure } });
  managed.start();
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
  expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ cause: failure }));
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(2));
  expect(managed.getStatus().failedRefreshes).toBe(2);
  await managed.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(onFailure).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("closes once and preserves audit flush failure without leaving a poll timer", async () => {
  const failure = new Error("audit flush failed");
  const flush = vi.fn().mockRejectedValue(failure);
  const managed = await runtime({
    ...options(source()),
    provider: { auditSink: { async write() {}, flush } }
  });
  const closing = managed.close();
  expect(managed.close()).toBe(closing);
  expect(managed.provider.onClose?.()).toBe(closing);
  await expect(closing).rejects.toThrow();
  expect(flush).toHaveBeenCalledTimes(1);
  expect(managed.getStatus().closed).toBe(true);
});

it.each([0, -1, 2_147_483_648, Number.NaN])(
  "rejects invalid polling interval %s before startup",
  async (refreshIntervalMs) => {
    await expect(
      createManagedLocalProvider({ ...options(source()), refreshIntervalMs })
    ).rejects.toThrow(RangeError);
  }
);

it("cancels startup during recovery before acquiring a provider", async () => {
  const abort = new AbortController();
  const input = source();
  const waiting = createManagedLocalProvider({ ...options(input), signal: abort.signal });
  abort.abort("stop startup");
  await expect(waiting).rejects.toThrow("cancelled");
  expect(input.fetch).not.toHaveBeenCalled();
});

it("releases provider diagnostics when refresher setup fails and retains cleanup errors", async () => {
  const close = vi.fn();
  const flush = vi.fn().mockRejectedValue(new Error("cleanup failed"));
  const waiting = createManagedLocalProvider({
    ...options(source()),
    refresh: { maxBytes: 0 },
    provider: {
      metrics: { bindStatus: () => ({ recordEvaluation() {}, close }) },
      auditSink: { async write() {}, flush }
    }
  });
  await expect(waiting).rejects.toMatchObject({
    errors: [expect.any(RangeError), expect.objectContaining({ message: "cleanup failed" })],
    cause: expect.any(RangeError)
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);
});

it.each(["resolve", "reject"] as const)(
  "bounds startup recovery and observes a late %s",
  async (settlement) => {
    let release!: (value: undefined) => void;
    let fail!: (cause: unknown) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise<undefined>((yes, no) => {
      release = yes;
      fail = no;
    });
    vi.spyOn(snapshotStores, "createFileSnapshotStore").mockReturnValue({
      load(request) {
        signal = request?.signal;
        return pending;
      },
      async commit() {
        throw new Error("unexpected commit");
      }
    });
    const bindStatus = vi.fn();
    const input = source();
    vi.useFakeTimers();
    const waiting = createManagedLocalProvider({
      ...options(input),
      refresh: { timeoutMs: 25 },
      provider: { metrics: { bindStatus } }
    });
    const failed = expect(waiting).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);
    await failed;
    expect(signal?.aborted).toBe(true);
    if (settlement === "resolve") release(undefined);
    else fail(new Error("late recovery failure"));
    await vi.advanceTimersByTimeAsync(100);
    expect(input.fetch).not.toHaveBeenCalled();
    expect(bindStatus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("captures bootstrap and env before asynchronous recovery", async () => {
  const bootstrap = JSON.parse(JSON.stringify(staticSnapshot));
  const env = { OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "true" };
  const waiting = runtime({ ...options(source()), bootstrap, provider: { env } });
  bootstrap.flags["checkout.enabled"].variants.on = false;
  env.OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED = "false";
  const managed = await waiting;
  expect(managed.provider.getSnapshot().flags["checkout.enabled"]?.variants.on).toBe(true);
  expect(
    (await managed.provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)).value
  ).toBe(true);
});

it.each([
  [24, true],
  [25, false],
  [26, false]
] as const)(
  "checks the startup recovery deadline before provider binding at %d ms",
  async (elapsed, allowed) => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    let signal: AbortSignal | undefined;
    vi.spyOn(snapshotStores, "createFileSnapshotStore").mockReturnValue({
      async load(request) {
        signal = request?.signal;
        now.mockReturnValue(elapsed);
        return undefined;
      },
      async commit() {
        throw new Error("unexpected commit");
      }
    });
    const input = source();
    const bindStatus = vi.fn();
    const waiting = runtime({
      ...options(input),
      refresh: { timeoutMs: 25 },
      provider: { metrics: { bindStatus } }
    });
    if (allowed) {
      const managed = await waiting;
      expect(bindStatus).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(false);
      await managed.close();
    } else {
      await expect(waiting).rejects.toThrow("recovery load cancelled or timed out");
      expect(bindStatus).not.toHaveBeenCalled();
      expect(signal?.aborted).toBe(true);
    }
    expect(input.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("shares shutdown even when a source abort callback reenters close", async () => {
  let managed: ManagedLocalProvider;
  let nested: Promise<void> | undefined;
  const flush = vi.fn(async () => {});
  const input = {
    fetch: vi.fn<SnapshotSource["fetch"]>((request) => {
      request?.signal?.addEventListener(
        "abort",
        () => {
          nested = managed.close();
        },
        { once: true }
      );
      return new Promise(() => {});
    })
  };
  managed = await runtime({
    ...options(input),
    provider: { auditSink: { async write() {}, flush } }
  });
  const waiting = managed.refresh();
  const failed = expect(waiting).rejects.toThrow("closed");
  await vi.waitFor(() => expect(input.fetch).toHaveBeenCalledTimes(1));
  const closing = managed.close();
  expect(nested).toBe(closing);
  await closing;
  await failed;
  expect(flush).toHaveBeenCalledTimes(1);
});
