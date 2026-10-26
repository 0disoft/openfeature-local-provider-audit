import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createLocalProvider } from "../../src/provider/local-provider.js";
import type { FileAuditSinkStats } from "../../src/public-types.js";

const snapshot = {
  schemaVersion: 1 as const,
  flags: { feature: { type: "boolean" as const, variants: { on: true }, defaultVariant: "on" } }
};
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function diagnostic(pending = false) {
  const delivered = vi.fn();
  const value = {
    // biome-ignore lint/suspicious/noThenProperty: This fixture tracks consumption of a deliberately rejecting or pending thenable.
    then(_resolve: (value: unknown) => void, reject: (cause: unknown) => void) {
      delivered();
      if (!pending) reject(new Error("diagnostic unavailable"));
    }
  };
  return { value, delivered };
}

function fixture(phase: "record" | "close" | "logger", value: unknown) {
  const storageFailure = new Error("storage unavailable");
  const warn = vi.fn(() => (phase === "logger" ? value : undefined));
  const provider = createLocalProvider({
    snapshot,
    env: {},
    metrics: {
      bindStatus: () => ({
        recordEvaluation: () => (phase === "record" ? value : undefined),
        close: () => (phase === "close" ? value : undefined)
      })
    },
    ...(phase === "logger"
      ? {
          auditSink: {
            async write() {
              throw storageFailure;
            }
          }
        }
      : {})
  });
  return { provider, logger: { ...quiet, warn }, warn, storageFailure };
}

it.each(["record", "close", "logger"] as const)(
  "isolates a rejecting %s diagnostic",
  async (phase) => {
    const { value, delivered } = diagnostic();
    const { provider, logger, warn, storageFailure } = fixture(phase, value);
    await expect(
      provider.resolveBooleanEvaluation("feature", false, {}, logger)
    ).resolves.toMatchObject({ value: true, reason: "STATIC" });
    await provider.onClose?.();
    await setImmediate();
    expect(delivered).toHaveBeenCalledOnce();
    if (phase === "logger") {
      expect(warn).toHaveBeenCalledWith(
        "openfeature-local-provider audit sink write failed",
        storageFailure
      );
      expect(provider.getStatus().audit.failedWrites).toBe(1);
    }
  }
);

it("does not wait for a diagnostic that never settles", async () => {
  const { value, delivered } = diagnostic(true);
  const { provider, logger } = fixture("record", value);
  await expect(
    provider.resolveBooleanEvaluation("feature", false, {}, logger)
  ).resolves.toMatchObject({ value: true });
  await provider.onClose?.();
  await setImmediate();
  expect(delivered).toHaveBeenCalledOnce();
});

it("preserves the real audit flush failure when diagnostic cleanup rejects", async () => {
  const { value, delivered } = diagnostic();
  const failure = new Error("flush unavailable");
  const provider = createLocalProvider({
    snapshot,
    env: {},
    metrics: { bindStatus: () => ({ recordEvaluation() {}, close: () => value }) },
    auditSink: {
      async write() {},
      async flush() {
        throw failure;
      }
    }
  });
  await expect(provider.onClose?.()).rejects.toBe(failure);
  await setImmediate();
  expect(delivered).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "ignores asynchronous sink counters without waiting (pending: %s)",
  async (pending) => {
    const { value, delivered } = diagnostic(pending);
    const provider = createLocalProvider({
      snapshot,
      env: {},
      auditSink: {
        async write() {},
        getStats: () => value as unknown as FileAuditSinkStats
      }
    });
    expect(provider.getStatus().audit.sinkStats).toBeUndefined();
    await expect(
      provider.resolveBooleanEvaluation("feature", false, {}, quiet)
    ).resolves.toMatchObject({ value: true, reason: "STATIC" });
    await provider.onClose?.();
    await setImmediate();
    expect(delivered).toHaveBeenCalledOnce();
  }
);

it("keeps asynchronous counters omitted and accepts later synchronous counters", async () => {
  const counters = {
    pendingWrites: 0,
    droppedWrites: 0,
    rejectedWrites: 0,
    maxQueueSize: 5,
    // biome-ignore lint/suspicious/noThenProperty: Non-callable extra metadata must not be mistaken for asynchronous counters.
    then: "metadata"
  };
  let stats: unknown = Promise.resolve(counters);
  const provider = createLocalProvider({
    snapshot,
    env: {},
    auditSink: { async write() {}, getStats: () => stats as FileAuditSinkStats }
  });
  expect(provider.getStatus().audit.sinkStats).toBeUndefined();
  await setImmediate();
  stats = counters;
  const captured = provider.getStatus().audit.sinkStats;
  expect(captured).toEqual({
    pendingWrites: 0,
    droppedWrites: 0,
    rejectedWrites: 0,
    maxQueueSize: 5
  });
  expect(Object.isFrozen(captured)).toBe(true);
  await provider.onClose?.();
});
