import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalProvider, createReloadableLocalProvider } from "../../src/index.js";
import type { FlagSnapshot, RefreshFailureKind } from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
afterEach(() => vi.restoreAllMocks());

describe("provider operational status", () => {
  it("tracks age and unchanged refreshes separately from semantic changes", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const provider = createReloadableLocalProvider({
      snapshot: staticSnapshot,
      staleAfterMs: 500,
      env: {}
    });
    const initial = provider.getStatus();
    expect(initial).toMatchObject({
      successfulRefreshes: 1,
      failedRefreshes: 0,
      lastSuccessfulRefreshAt: 1_000,
      lastChangedAt: 1_000,
      stale: false,
      closed: false,
      audit: { enabled: false, pendingWrites: 0 }
    });
    clock.mockReturnValue(1_500);
    expect(provider.getStatus().stale).toBe(true);
    provider.updateSnapshot(structuredClone(staticSnapshot));
    expect(provider.getStatus()).toMatchObject({
      snapshotHash: initial.snapshotHash,
      successfulRefreshes: 2,
      lastSuccessfulRefreshAt: 1_500,
      lastChangedAt: 1_000,
      stale: false
    });
    clock.mockReturnValue(2_000);
    provider.updateSnapshot({ ...staticSnapshot, metadata: { release: "two" } });
    expect(provider.getStatus()).toMatchObject({
      successfulRefreshes: 3,
      lastSuccessfulRefreshAt: 2_000,
      lastChangedAt: 2_000
    });
    expect(provider.getStatus().snapshotHash).not.toBe(initial.snapshotHash);
    expect(initial.successfulRefreshes).toBe(1);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.audit)).toBe(true);
  });

  it("preserves the last good snapshot and records loader failures without exception data", async () => {
    const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
    const initial = provider.getStatus();
    expect(() =>
      provider.updateSnapshot({ schemaVersion: 99, flags: {} } as unknown as FlagSnapshot)
    ).toThrow();
    provider.reportRefreshFailure("load");
    expect(provider.getStatus()).toMatchObject({
      snapshotHash: initial.snapshotHash,
      successfulRefreshes: 1,
      failedRefreshes: 2,
      consecutiveRefreshFailures: 2,
      lastRefreshFailure: "load"
    });
    expect(provider.getSnapshot()).toEqual(staticSnapshot);
    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({ value: true });
    provider.updateSnapshot(staticSnapshot);
    expect(provider.getStatus()).toMatchObject({
      failedRefreshes: 2,
      consecutiveRefreshFailures: 0,
      lastRefreshFailure: "load",
      stale: false
    });
    expect(() => provider.reportRefreshFailure("private-error" as RefreshFailureKind)).toThrow(
      RangeError
    );
    expect(provider.getStatus().failedRefreshes).toBe(2);
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid freshness threshold %s",
    (staleAfterMs) => {
      expect(() => createLocalProvider({ snapshot: staticSnapshot, staleAfterMs })).toThrow(
        RangeError
      );
    }
  );

  it("does not mark a static provider stale unless opted in, and reports lifecycle closure", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const provider = createLocalProvider({ snapshot: staticSnapshot, env: {} });
    clock.mockReturnValue(1_000_000);
    expect(provider.getStatus().stale).toBe(false);
    await provider.onClose?.();
    expect(provider.getStatus().closed).toBe(true);
  });

  it("observes concurrent audit completion and rejection without changing flag results", async () => {
    let resolveFirst!: () => void;
    let rejectSecond!: (error: Error) => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<void>((_resolve, reject) => {
      rejectSecond = reject;
    });
    const write = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {},
      auditSink: { write },
      auditWriteMode: "blocking"
    });
    const a = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    const b = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    expect(provider.getStatus().audit).toMatchObject({
      attemptedWrites: 2,
      pendingWrites: 2,
      resolvedWrites: 0,
      failedWrites: 0
    });
    resolveFirst();
    await expect(a).resolves.toMatchObject({ value: true });
    rejectSecond(new Error("private path and user data"));
    await expect(b).resolves.toMatchObject({ value: true });
    expect(provider.getStatus().audit).toMatchObject({
      attemptedWrites: 2,
      pendingWrites: 0,
      resolvedWrites: 1,
      failedWrites: 1,
      lastFailureAt: expect.any(Number)
    });
    expect(JSON.stringify(provider.getStatus())).not.toContain("private");
  });

  it("copies only documented sink counters and tolerates broken custom diagnostics", async () => {
    const stats = {
      pendingWrites: 3,
      droppedWrites: 2,
      rejectedWrites: 1,
      maxQueueSize: 5,
      privatePath: "/private/customer"
    };
    const getStats = vi.fn(() => stats);
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {},
      auditSink: { write: async () => {}, getStats },
      auditWriteMode: "blocking"
    });
    await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    const status = provider.getStatus();
    expect(status.audit.sinkStats).toEqual({
      pendingWrites: 3,
      droppedWrites: 2,
      rejectedWrites: 1,
      maxQueueSize: 5
    });
    expect(status.audit.resolvedWrites).toBe(1);
    expect(Object.isFrozen(status.audit.sinkStats)).toBe(true);
    expect(JSON.stringify(status)).not.toContain("private");
    stats.droppedWrites = 9;
    expect(status.audit.sinkStats?.droppedWrites).toBe(2);
    stats.maxQueueSize = 0;
    expect(provider.getStatus().audit.sinkStats).toBeUndefined();
    stats.maxQueueSize = 5;
    stats.droppedWrites = -1;
    expect(provider.getStatus().audit.sinkStats).toBeUndefined();
    getStats.mockImplementation(() => {
      throw new Error("diagnostics failed");
    });
    expect(provider.getStatus().audit.sinkStats).toBeUndefined();
  });

  it("accepts unbounded sink diagnostics without interpreting acknowledgments as delivery", () => {
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {},
      auditSink: {
        write: async () => {},
        getStats: () => ({
          pendingWrites: 0,
          droppedWrites: 1,
          rejectedWrites: 0,
          maxQueueSize: null
        })
      }
    });
    expect(provider.getStatus().audit.sinkStats?.maxQueueSize).toBeNull();
    expect(provider.getStatus().audit.sinkStats?.droppedWrites).toBe(1);
  });
});
