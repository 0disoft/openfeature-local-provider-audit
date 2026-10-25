import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createWatchedLocalProvider,
  type WatchedLocalProvider,
  type WatchFlagSnapshotFileOptions
} from "../../src/index.js";
import * as files from "../../src/flags/snapshot-file.js";
import { staticSnapshot } from "../fixtures.js";

let directory: string;
let path: string;
const runtimes: WatchedLocalProvider[] = [];
const logger = { debug() {}, info() {}, warn() {}, error() {} };
async function runtime(extra: Partial<Parameters<typeof createWatchedLocalProvider>[0]> = {}) {
  const owned = await createWatchedLocalProvider({
    path,
    debounceMs: 0,
    consistencyPollIntervalMs: 50,
    ...extra
  });
  runtimes.push(owned);
  return owned;
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-watched-"));
  path = join(directory, "flags.json");
  await writeFile(path, JSON.stringify(staticSnapshot));
});
afterEach(async () => {
  for (const owned of runtimes.splice(0)) await owned.close().catch(() => {});
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-watched-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

it("uses one initial load and defaults to no ambient env overrides", async () => {
  vi.stubEnv("OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED", "false");
  const owned = await runtime();
  expect(owned.getStatus().successfulRefreshes).toBe(1);
  expect(owned.getStatus().provenance).toBeUndefined();
  expect(
    (await owned.provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)).value
  ).toBe(true);
});

it("supports YAML and explicit env without mutating the input", async () => {
  path = join(directory, "flags.yaml");
  await writeFile(
    path,
    `schemaVersion: 1
flags:
  feature:
    type: boolean
    variants: {on: true, off: false}
    defaultVariant: on
    envVar: FEATURE
`
  );
  const env = { FEATURE: "false" };
  const owned = await runtime({ provider: { env } });
  env.FEATURE = "true";
  expect((await owned.provider.resolveBooleanEvaluation("feature", true, {}, logger)).value).toBe(
    false
  );
});

it("preserves unchanged automatic suppression but explicit reload renews validation", async () => {
  const owned = await runtime();
  const initial = owned.getStatus();
  await writeFile(path, JSON.stringify(staticSnapshot, null, 2));
  await new Promise((done) => setTimeout(done, 200));
  expect(owned.getStatus().successfulRefreshes).toBe(1);
  await owned.reload();
  const after = owned.getStatus();
  expect(after.successfulRefreshes).toBe(2);
  expect(after.lastChangedAt).toBe(initial.lastChangedAt);
  expect(after.snapshotHash).toBe(initial.snapshotHash);
});

it("applies atomic replacement and SDK shutdown prevents later delivery", async () => {
  const owned = await runtime();
  const next = JSON.parse(JSON.stringify(staticSnapshot));
  next.flags["checkout.enabled"].defaultVariant = "off";
  const nextPath = join(directory, "next.json");
  await writeFile(nextPath, JSON.stringify(next));
  await rename(nextPath, path);
  await vi.waitFor(() =>
    expect(owned.provider.getSnapshot().flags["checkout.enabled"]?.defaultVariant).toBe("off")
  );
  const closing = owned.provider.onClose?.();
  expect(owned.close()).toBe(closing);
  await closing;
  await writeFile(path, JSON.stringify(staticSnapshot));
  await expect(owned.reload()).rejects.toThrow("closed");
  expect(owned.provider.getSnapshot().flags["checkout.enabled"]?.defaultVariant).toBe("off");
  expect(owned.getStatus().closed).toBe(true);
});

it("retains last good state on malformed file and recovers after explicit reload", async () => {
  const onFailure = vi.fn();
  const owned = await runtime({ onFailure });
  const initial = owned.getStatus().snapshotHash;
  await writeFile(path, "not json");
  await expect(owned.reload()).rejects.toThrow();
  expect(owned.getStatus().snapshotHash).toBe(initial);
  expect(owned.getStatus().failedRefreshes).toBe(onFailure.mock.calls.length);
  expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "load" }));
  await writeFile(path, JSON.stringify(staticSnapshot));
  await owned.reload();
  expect(owned.getStatus().consecutiveRefreshFailures).toBe(0);
});

it("does not double-count provider rejection or accept a pending transaction", async () => {
  const onFailure = vi.fn();
  const owned = await runtime({ onFailure });
  const reservation = owned.provider.prepareSnapshot?.(staticSnapshot);
  expect(reservation).toBeDefined();
  await expect(owned.reload()).rejects.toThrow("pending persistence");
  expect(owned.getStatus().failedRefreshes).toBe(1);
  expect(onFailure).toHaveBeenCalledTimes(1);
  reservation?.cancel();
  await owned.reload();
  expect(owned.getStatus().consecutiveRefreshFailures).toBe(0);
});

it("isolates rejected asynchronous failure diagnostics", async () => {
  const owned = await runtime({
    onFailure: async () => {
      throw new Error("diagnostics failed");
    }
  });
  await writeFile(path, "broken");
  await expect(owned.reload()).rejects.toThrow();
  await writeFile(path, JSON.stringify(staticSnapshot));
  await expect(owned.reload()).resolves.toMatchObject({ schemaVersion: 1 });
});

it("rejects missing/invalid startup without binding provider diagnostics", async () => {
  const bindStatus = vi.fn();
  await writeFile(path, "broken");
  await expect(
    createWatchedLocalProvider({ path, provider: { metrics: { bindStatus } } })
  ).rejects.toThrow();
  expect(bindStatus).not.toHaveBeenCalled();
});

it("rejects invalid watch options before creating provider state", async () => {
  await expect(createWatchedLocalProvider({ path, debounceMs: -1 })).rejects.toThrow(RangeError);
});

it("deduplicates coalesced automatic and explicit errors", async () => {
  let callbacks!: WatchFlagSnapshotFileOptions;
  const cause = new Error("shared read failure");
  vi.spyOn(files, "watchFlagSnapshotFile").mockImplementation(async (input) => {
    callbacks = input;
    await input.onSnapshot(staticSnapshot);
    return {
      path,
      getSnapshot: () => staticSnapshot,
      close() {},
      async reload() {
        await callbacks.onError?.(cause);
        throw cause;
      }
    };
  });
  const onFailure = vi.fn();
  const owned = await runtime({ onFailure });
  const waiting = owned.reload();
  expect(owned.reload()).toBe(waiting);
  await expect(waiting).rejects.toBe(cause);
  expect(owned.getStatus().failedRefreshes).toBe(1);
  expect(onFailure).toHaveBeenCalledTimes(1);
  await expect(owned.reload()).rejects.toBe(cause);
  expect(owned.getStatus().failedRefreshes).toBe(2);
  expect(onFailure).toHaveBeenCalledTimes(2);
});

it("attempts provider shutdown after watcher release fails and preserves both errors", async () => {
  const releaseError = new Error("watcher release failed");
  const flushError = new Error("audit flush failed");
  const release = vi.fn(() => {
    throw releaseError;
  });
  const flush = vi.fn(async () => {
    throw flushError;
  });
  vi.spyOn(files, "watchFlagSnapshotFile").mockImplementation(async (input) => {
    await input.onSnapshot(staticSnapshot);
    return {
      path,
      getSnapshot: () => staticSnapshot,
      close: release,
      reload: async () => staticSnapshot
    };
  });
  const owned = await runtime({ provider: { auditSink: { async write() {}, flush } } });
  const closing = owned.close();
  expect(owned.provider.onClose?.()).toBe(closing);
  await expect(closing).rejects.toMatchObject({
    errors: [releaseError, flushError],
    cause: releaseError
  });
  expect(release).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(owned.getStatus().closed).toBe(true);
});

it("cleans up the acquired provider after watcher setup fails", async () => {
  const cause = new Error("watch setup failed after delivery");
  const close = vi.fn();
  vi.spyOn(files, "watchFlagSnapshotFile").mockImplementation(async (input) => {
    await input.onSnapshot(staticSnapshot);
    throw cause;
  });
  await expect(
    createWatchedLocalProvider({
      path,
      provider: { metrics: { bindStatus: () => ({ recordEvaluation() {}, close }) } }
    })
  ).rejects.toBe(cause);
  expect(close).toHaveBeenCalledTimes(1);
});

it("retries the same file content after an application rejection", async () => {
  const onFailure = vi.fn();
  const owned = await runtime({ onFailure });
  const reservation = owned.provider.prepareSnapshot?.(staticSnapshot);
  const next = JSON.parse(JSON.stringify(staticSnapshot));
  next.flags["checkout.enabled"].defaultVariant = "off";
  await writeFile(path, JSON.stringify(next));
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());
  expect(owned.provider.getSnapshot().flags["checkout.enabled"]?.defaultVariant).toBe("on");
  reservation?.cancel();
  await writeFile(path, JSON.stringify(next, null, 2));
  await vi.waitFor(() =>
    expect(owned.provider.getSnapshot().flags["checkout.enabled"]?.defaultVariant).toBe("off")
  );
  expect(owned.getStatus().consecutiveRefreshFailures).toBe(0);
});
