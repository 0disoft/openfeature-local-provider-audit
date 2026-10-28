import { afterEach, expect, it, vi } from "vitest";
import { createLocalProvider, type AuditSink } from "../../src/index.js";
import { flushAuditSink } from "../../src/provider/audit-policy.js";
import { staticSnapshot } from "../fixtures.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([4, 5, 6])(
  "checks a %ims synchronous completion against the 5ms deadline",
  async (elapsed) => {
    vi.useFakeTimers();
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    const writeConfirmed = vi.fn(() => {
      tick = elapsed;
      return Promise.resolve();
    });
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {},
      auditFailurePolicy: "returnDefault",
      auditTimeoutMs: 5,
      auditCorrelation: true,
      auditSink: { write: async () => {}, writeConfirmed }
    });
    const result = await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    expect(result.value).toBe(elapsed < 5);
    expect(result.reason).toBe(elapsed < 5 ? "STATIC" : "ERROR");
    expect(result.flagMetadata?.localProviderAuditWriteOutcome).toBe(
      elapsed < 5 ? "confirmed" : "timedOut"
    );
    expect(provider.getStatus().audit).toMatchObject({
      attemptedWrites: 1,
      resolvedWrites: 1,
      failedWrites: 0,
      pendingWrites: 0,
      timedOutWrites: elapsed < 5 ? 0 : 1
    });
    expect(writeConfirmed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  }
);

it.each([4, 5, 6])(
  "checks an asynchronous %ims completion before delayed timers execute",
  async (elapsed) => {
    vi.useFakeTimers();
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {},
      auditFailurePolicy: "returnDefault",
      auditTimeoutMs: 5,
      auditSink: {
        write: async () => {},
        writeConfirmed: () =>
          Promise.resolve().then(() => {
            tick = elapsed;
          })
      }
    });
    const result = await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    expect(result.value).toBe(elapsed < 5);
    expect(provider.getStatus().audit.timedOutWrites).toBe(elapsed < 5 ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("keeps best-effort candidate values but reports late completion as timed out", async () => {
  vi.useFakeTimers();
  let tick = 0;
  vi.spyOn(performance, "now").mockImplementation(() => tick);
  const provider = createLocalProvider({
    snapshot: staticSnapshot,
    env: {},
    auditWriteMode: "blocking",
    auditTimeoutMs: 5,
    auditCorrelation: true,
    auditSink: {
      write: () => {
        tick = 6;
        return Promise.resolve();
      }
    }
  });
  const result = await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
  expect(result).toMatchObject({
    value: true,
    reason: "STATIC",
    flagMetadata: {
      localProviderAuditWriteOutcome: "timedOut",
      localProviderAuditDefaultApplied: false
    }
  });
  expect(provider.getStatus().audit).toMatchObject({
    resolvedWrites: 1,
    timedOutWrites: 1,
    pendingWrites: 0
  });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([4, 5, 6])(
  "checks shutdown completion at %ims and keeps the sink receiver",
  async (elapsed) => {
    vi.useFakeTimers();
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    const sink: AuditSink = {
      write: async () => {},
      flush() {
        expect(this).toBe(sink);
        return Promise.resolve().then(() => {
          tick = elapsed;
        });
      }
    };
    const closing = flushAuditSink(sink, 5);
    if (elapsed < 5) await expect(closing).resolves.toBeUndefined();
    else await expect(closing).rejects.toMatchObject({ code: "AUDIT_SINK_ERROR" });
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("preserves original flush errors instead of replacing their cause", async () => {
  vi.useFakeTimers();
  const cause = new Error("storage rejected");
  await expect(
    flushAuditSink(
      {
        write: async () => {},
        flush: async () => {
          throw cause;
        }
      },
      5
    )
  ).rejects.toBe(cause);
  expect(vi.getTimerCount()).toBe(0);
});
