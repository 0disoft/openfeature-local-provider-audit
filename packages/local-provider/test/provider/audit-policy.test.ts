import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCode, OpenFeature, ProviderEvents } from "@openfeature/server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFileAuditSink,
  createLocalProvider,
  type AuditEvent,
  type AuditSink
} from "../../src/index.js";
import { resolveAuditPolicy } from "../../src/provider/audit-policy.js";
import { staticSnapshot } from "../fixtures.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const options = { snapshot: staticSnapshot, env: {} };
afterEach(() => vi.useRealTimers());

describe("audit confirmation policy", () => {
  it("bounds shutdown, immediately releases diagnostics and observes a late flush rejection", async () => {
    vi.useFakeTimers();
    let rejectFlush!: (error: Error) => void;
    const pending = new Promise<void>((_, reject) => {
      rejectFlush = reject;
    });
    const flush = vi.fn(function (this: AuditSink) {
      expect(this).toBe(sink);
      return pending;
    });
    const sink: AuditSink = { write: async () => {}, flush };
    let reentrantClose: Promise<void> | undefined;
    const close = vi.fn(() => {
      reentrantClose = provider.onClose?.();
    });
    const provider = createLocalProvider({
      ...options,
      auditSink: sink,
      auditShutdownTimeoutMs: 25,
      metrics: { bindStatus: () => ({ recordEvaluation() {}, close }) }
    });
    provider.events?.addHandler(ProviderEvents.ConfigurationChanged, vi.fn());
    const closing = provider.onClose?.();
    const rejected = expect(closing).rejects.toThrow("Audit shutdown flush timed out");
    expect(provider.onClose?.()).toBe(closing);
    expect(reentrantClose).toBe(closing);
    expect(provider.getStatus().closed).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(provider.events?.getHandlers(ProviderEvents.ConfigurationChanged)).toEqual([]);
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(flush).toHaveBeenCalledOnce();
    rejectFlush(new Error("late flush failure"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("clears the shutdown deadline after flush succeeds or fails", async () => {
    vi.useFakeTimers();
    for (const failure of [undefined, new Error("flush failure")]) {
      const provider = createLocalProvider({
        ...options,
        auditSink: {
          write: async () => {},
          flush: async () => {
            if (failure) throw failure;
          }
        }
      });
      if (failure) await expect(provider.onClose?.()).rejects.toBe(failure);
      else await provider.onClose?.();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects invalid shutdown limit %s",
    (auditShutdownTimeoutMs) => {
      expect(() =>
        createLocalProvider({
          ...options,
          auditShutdownTimeoutMs,
          auditSink: { write: async () => {} }
        })
      ).toThrow(RangeError);
    }
  );

  it("rejects a shutdown limit without a sink", () => {
    expect(() => createLocalProvider({ ...options, auditShutdownTimeoutMs: 100 })).toThrow(
      TypeError
    );
  });

  it("confirms none-mode audits without enumerating context keys or producing a false failure", async () => {
    const enumerate = vi.fn(() => {
      throw new Error("key enumeration is unavailable");
    });
    const context = new Proxy({ targetingKey: "synthetic-subject" }, { ownKeys: enumerate });
    const events: AuditEvent[] = [];
    const provider = createLocalProvider({
      ...options,
      auditRedaction: { contextKeys: "none" },
      auditFailurePolicy: "returnDefault",
      auditSink: {
        async write() {},
        async writeConfirmed(event) {
          events.push(event);
        }
      }
    });
    try {
      await expect(
        provider.resolveBooleanEvaluation("checkout.enabled", false, context, logger)
      ).resolves.toMatchObject({ value: true, reason: "STATIC" });
      expect(enumerate).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]?.context).toEqual({
        targetingKeyPresent: true,
        keyMode: "none",
        keys: [],
        redacted: true
      });
      expect(provider.getStatus().audit).toMatchObject({ resolvedWrites: 1, failedWrites: 0 });
    } finally {
      await provider.onClose?.();
    }
  });

  it("uses confirmed writes with their receiver and cancels the wait timer on success", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const sink = {
      write,
      writeConfirmed: vi.fn(async function (this: AuditSink) {
        expect(this).toBe(sink);
      })
    };
    const provider = createLocalProvider({
      ...options,
      auditSink: sink,
      auditFailurePolicy: "returnDefault"
    });
    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({ value: true, reason: "STATIC" });
    expect(sink.writeConfirmed).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(provider.getStatus().audit).toMatchObject({
      resolvedWrites: 1,
      failedWrites: 0,
      timedOutWrites: 0,
      pendingWrites: 0
    });
  });

  it("returns a visible default/error through the actual OpenFeature SDK on failure", async () => {
    const provider = createLocalProvider({
      ...options,
      auditFailurePolicy: "returnDefault",
      auditSink: {
        write: async () => {},
        writeConfirmed: async () => {
          throw new Error("private storage failure");
        }
      }
    });
    const domain = "audit-confirmation-contract";
    await OpenFeature.setProviderAndWait(domain, provider);
    try {
      const details = await OpenFeature.getClient(domain).getBooleanDetails(
        "checkout.enabled",
        false
      );
      expect(details).toMatchObject({
        value: false,
        reason: "ERROR",
        errorCode: ErrorCode.GENERAL
      });
      expect(details.variant).toBeUndefined();
      expect(JSON.stringify(details)).not.toContain("private");
      expect(provider.getStatus().audit.failedWrites).toBe(1);
    } finally {
      await OpenFeature.clearProviders();
    }
  });

  it("bounds confirmation waiting, observes late failure and leaves pending writes visible", async () => {
    vi.useFakeTimers();
    let rejectWrite!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    });
    const provider = createLocalProvider({
      ...options,
      auditFailurePolicy: "returnDefault",
      auditTimeoutMs: 25,
      auditSink: { write: async () => {}, writeConfirmed: () => pending }
    });
    const result = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toMatchObject({
      value: false,
      reason: "ERROR",
      errorCode: ErrorCode.GENERAL
    });
    expect(provider.getStatus().audit).toMatchObject({
      pendingWrites: 1,
      failedWrites: 0,
      timedOutWrites: 1
    });
    expect(vi.getTimerCount()).toBe(0);
    rejectWrite(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.getStatus().audit).toMatchObject({
      pendingWrites: 0,
      failedWrites: 1,
      timedOutWrites: 1
    });
  });

  it("supports bounded best-effort waiting without changing the selected variant", async () => {
    vi.useFakeTimers();
    let resolveWrite!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const provider = createLocalProvider({
      ...options,
      auditWriteMode: "blocking",
      auditTimeoutMs: 10,
      auditSink: { write: () => pending }
    });
    const result = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ value: true, reason: "STATIC", variant: "on" });
    resolveWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.getStatus().audit).toMatchObject({
      resolvedWrites: 1,
      timedOutWrites: 1,
      pendingWrites: 0
    });
  });

  it.each(["resolve", "reject"])(
    "bounds best-effort blocking by default and observes late %s exactly once",
    async (outcome) => {
      vi.useFakeTimers();
      let resolve!: () => void, reject!: (error: Error) => void;
      const pending = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const write = vi.fn(() => pending);
      const provider = createLocalProvider({
        ...options,
        auditWriteMode: "blocking",
        auditSink: { write }
      });
      let completed = false;
      const result = provider
        .resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
        .then((value) => {
          completed = true;
          return value;
        });
      await vi.advanceTimersByTimeAsync(999);
      expect(completed).toBe(false);
      expect(provider.getStatus().audit).toMatchObject({ pendingWrites: 1, timedOutWrites: 0 });
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ value: true, reason: "STATIC", variant: "on" });
      expect(provider.getStatus().audit).toMatchObject({
        pendingWrites: 1,
        timedOutWrites: 1,
        failedWrites: 0,
        resolvedWrites: 0
      });
      expect(vi.getTimerCount()).toBe(0);
      if (outcome === "resolve") resolve();
      else reject(new Error("late private storage failure"));
      await vi.advanceTimersByTimeAsync(0);
      expect(provider.getStatus().audit).toMatchObject({
        pendingWrites: 0,
        timedOutWrites: 1,
        failedWrites: outcome === "reject" ? 1 : 0,
        resolvedWrites: outcome === "resolve" ? 1 : 0
      });
      expect(write).toHaveBeenCalledOnce();
    }
  );

  it("derives deadlines only for enabled blocking sinks and honors explicit limits", () => {
    const sink = { write: async () => {}, writeConfirmed: async () => {} };
    expect(resolveAuditPolicy(options).timeoutMs).toBeUndefined();
    expect(
      resolveAuditPolicy({ ...options, auditWriteMode: "blocking" }).timeoutMs
    ).toBeUndefined();
    expect(resolveAuditPolicy({ ...options, auditSink: sink }).timeoutMs).toBeUndefined();
    expect(
      resolveAuditPolicy({ ...options, auditSink: sink, auditWriteMode: "blocking" }).timeoutMs
    ).toBe(1000);
    expect(
      resolveAuditPolicy({ ...options, auditSink: sink, auditFailurePolicy: "returnDefault" })
        .timeoutMs
    ).toBe(1000);
    expect(
      resolveAuditPolicy({
        ...options,
        auditSink: sink,
        auditWriteMode: "blocking",
        auditTimeoutMs: 2000
      }).timeoutMs
    ).toBe(2000);
  });

  it("treats removal of confirmation after construction as a failure", async () => {
    const auditSink: AuditSink = { write: async () => {}, writeConfirmed: async () => {} };
    const provider = createLocalProvider({
      ...options,
      auditSink,
      auditFailurePolicy: "returnDefault"
    });
    delete auditSink.writeConfirmed;
    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({ value: false, reason: "ERROR" });
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects an invalid audit wait limit %s",
    (auditTimeoutMs) => {
      expect(() =>
        createLocalProvider({
          ...options,
          auditTimeoutMs,
          auditWriteMode: "blocking",
          auditSink: { write: async () => {} }
        })
      ).toThrow(RangeError);
    }
  );

  it("rejects contradictory and unconfirmable options before any evaluation", () => {
    expect(() =>
      createLocalProvider({
        ...options,
        auditFailurePolicy: "wrong" as never
      })
    ).toThrow(RangeError);
    expect(() =>
      createLocalProvider({
        ...options,
        auditWriteMode: "wrong" as never
      })
    ).toThrow(RangeError);
    expect(() =>
      createLocalProvider({
        ...options,
        auditFailurePolicy: "returnDefault"
      })
    ).toThrow(TypeError);
    expect(() =>
      createLocalProvider({
        ...options,
        auditFailurePolicy: "returnDefault",
        auditSink: { write: async () => {} }
      })
    ).toThrow(TypeError);
    expect(() =>
      createLocalProvider({
        ...options,
        auditFailurePolicy: "returnDefault",
        auditWriteMode: "nonBlocking",
        auditSink: { write: async () => {}, writeConfirmed: async () => {} }
      })
    ).toThrow(TypeError);
    expect(() =>
      createLocalProvider({
        ...options,
        auditTimeoutMs: 1,
        auditSink: { write: async () => {} }
      })
    ).toThrow(TypeError);
    expect(() =>
      createLocalProvider({
        ...options,
        auditTimeoutMs: 1,
        auditWriteMode: "blocking"
      })
    ).toThrow(TypeError);
  });

  it("rejects confirmed file writes on a full dropNewest queue and confirms actual append", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfeature-audit-confirmed-"));
    const path = join(directory, "audit.jsonl");
    try {
      const sink = createFileAuditSink({
        path,
        maxQueueSize: 1,
        queueOverflowPolicy: "dropNewest"
      });
      const provider = createLocalProvider({
        ...options,
        auditSink: sink,
        auditFailurePolicy: "returnDefault"
      });
      const first = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
      await expect(
        provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
      ).resolves.toMatchObject({ value: false, reason: "ERROR" });
      await expect(first).resolves.toMatchObject({ value: true, reason: "STATIC" });
      await sink.flush?.();
      const lines = (await readFile(path, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      const event = JSON.parse(lines[0] ?? "") as AuditEvent;
      expect(event.flagKey).toBe("checkout.enabled");
      expect(sink.getStats?.()).toMatchObject({
        pendingWrites: 0,
        droppedWrites: 0,
        rejectedWrites: 1
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
