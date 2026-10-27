import { ErrorCode, OpenFeature } from "@openfeature/server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalProvider,
  createReloadableLocalProvider,
  type AuditEvent,
  type AuditSink,
  type ProviderAuditOutcome
} from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const options = { snapshot: staticSnapshot, env: {} };
afterEach(() => vi.useRealTimers());

describe("provider audit outcome correlation", () => {
  it.each([false, true])("leaves metadata opt-in (enabled=%s)", async (enabled) => {
    const outcomes: ProviderAuditOutcome[] = [];
    const provider = createLocalProvider({
      ...options,
      auditCorrelation: enabled,
      onAuditOutcome: (outcome) => outcomes.push(outcome)
    });
    const result = await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    expect(result.flagMetadata).toEqual(
      enabled
        ? {
            owner: "checkout",
            localProviderAuditWriteOutcome: "notRequested",
            localProviderAuditDefaultApplied: false
          }
        : { owner: "checkout" }
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ writeOutcome: "notRequested", auditDefaultApplied: false });
    expect(outcomes[0]?.eventId).toBeUndefined();
  });

  it.each([false, true])(
    "links SDK details to candidate records on audit failure=%s",
    async (fail) => {
      const events: AuditEvent[] = [];
      const outcomes: ProviderAuditOutcome[] = [];
      const provider = createLocalProvider({
        ...options,
        auditCorrelation: true,
        auditFailurePolicy: "returnDefault",
        onAuditOutcome: (outcome) => outcomes.push(outcome),
        auditSink: {
          async write() {},
          async writeConfirmed(event) {
            events.push(event);
            if (fail) throw new Error("private storage failure");
          }
        }
      });
      const domain = "audit-outcome-contract";
      await OpenFeature.setProviderAndWait(domain, provider);
      try {
        const details = await OpenFeature.getClient(domain).getBooleanDetails(
          "checkout.enabled",
          false,
          {
            targetingKey: "private-subject",
            privateAttribute: "private-value"
          }
        );
        expect(details.value).toBe(!fail);
        expect(details.errorCode).toBe(fail ? ErrorCode.GENERAL : undefined);
        expect(details.flagMetadata).toMatchObject({
          localProviderAuditEventId: events[0]?.eventId,
          localProviderAuditWriteOutcome: fail ? "failed" : "confirmed",
          localProviderAuditDefaultApplied: fail
        });
        expect(events[0]).toMatchObject({ reason: "STATIC", variant: "on" });
        expect(outcomes[0]).toEqual({
          eventId: events[0]?.eventId,
          snapshotHash: events[0]?.snapshotHash,
          requestedType: "boolean",
          reason: fail ? "ERROR" : "STATIC",
          source: fail ? "error" : "file",
          ...(fail ? { errorCode: "AUDIT_SINK_ERROR" } : {}),
          writeOutcome: fail ? "failed" : "confirmed",
          auditDefaultApplied: fail
        });
        expect(Object.isFrozen(outcomes[0])).toBe(true);
        expect(JSON.stringify(outcomes)).not.toContain("private");
        expect(JSON.stringify(outcomes)).not.toContain("value");
      } finally {
        await OpenFeature.clearProviders();
      }
    }
  );

  it.each(["bestEffort", "returnDefault"] as const)(
    "keeps the at-return timeout outcome immutable after a late append (%s)",
    async (auditFailurePolicy) => {
      vi.useFakeTimers();
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const events: AuditEvent[] = [];
      const write = vi.fn(async (event: AuditEvent) => {
        events.push(event);
        await pending;
      });
      const outcomes: ProviderAuditOutcome[] = [];
      const provider = createLocalProvider({
        ...options,
        auditCorrelation: true,
        auditFailurePolicy,
        auditWriteMode: "blocking",
        auditTimeoutMs: 25,
        auditSink: { write, writeConfirmed: write },
        onAuditOutcome: (outcome) => outcomes.push(outcome)
      });
      const pendingResult = provider.resolveBooleanEvaluation(
        "checkout.enabled",
        false,
        {},
        logger
      );
      await vi.advanceTimersByTimeAsync(25);
      const result = await pendingResult;
      expect(result.value).toBe(auditFailurePolicy === "bestEffort");
      expect(result.flagMetadata).toMatchObject({
        localProviderAuditEventId: events[0]?.eventId,
        localProviderAuditWriteOutcome: "timedOut",
        localProviderAuditDefaultApplied: auditFailurePolicy === "returnDefault"
      });
      complete();
      await vi.advanceTimersByTimeAsync(0);
      expect(provider.getStatus().audit).toMatchObject({ resolvedWrites: 1, pendingWrites: 0 });
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.writeOutcome).toBe("timedOut");
      expect(result.flagMetadata?.localProviderAuditWriteOutcome).toBe("timedOut");
      expect(write).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("distinguishes pending enqueue from submitted, never claiming ordinary writes are confirmed", async () => {
    for (const auditWriteMode of ["nonBlocking", "blocking"] as const) {
      const provider = createLocalProvider({
        ...options,
        auditCorrelation: true,
        auditWriteMode,
        auditSink: { write: async () => {} }
      });
      const result = await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
      expect(result.flagMetadata?.localProviderAuditWriteOutcome).toBe(
        auditWriteMode === "blocking" ? "submitted" : "pending"
      );
    }
  });

  it.each(["throw", "reject", "never"])(
    "isolates %s observers without another audit write",
    async (mode) => {
      const write = vi.fn(async () => {});
      const provider = createLocalProvider({
        ...options,
        auditCorrelation: true,
        auditSink: { write },
        onAuditOutcome: () => {
          if (mode === "throw") throw new Error("observer failure");
          return mode === "reject"
            ? Promise.reject(new Error("observer rejection"))
            : new Promise(() => {});
        }
      });
      await expect(
        provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
      ).resolves.toMatchObject({
        value: true,
        reason: "STATIC"
      });
      await Promise.resolve();
      expect(write).toHaveBeenCalledOnce();
    }
  );

  it("omits nonexistent or forged event IDs when redaction fails before event creation", async () => {
    const snapshot = {
      ...staticSnapshot,
      flags: {
        demo: {
          type: "boolean" as const,
          defaultVariant: "on",
          variants: { on: true },
          metadata: { localProviderAuditEventId: "forged" }
        }
      }
    };
    const write = vi.fn();
    const provider = createLocalProvider({
      snapshot,
      env: {},
      auditCorrelation: true,
      auditWriteMode: "blocking",
      auditSink: { write }
    });
    const context = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("private redaction failure");
        }
      }
    );
    const result = await provider.resolveBooleanEvaluation("demo", false, context, logger);
    expect(result.flagMetadata?.localProviderAuditWriteOutcome).toBe("failed");
    expect(result.flagMetadata?.localProviderAuditEventId).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps concurrent attempts and snapshot identities separate when writes finish out of order", async () => {
    const events: AuditEvent[] = [];
    const complete: (() => void)[] = [];
    const sink: AuditSink = {
      async write() {},
      writeConfirmed(event) {
        events.push(event);
        return new Promise<void>((resolve) => complete.push(resolve));
      }
    };
    const provider = createReloadableLocalProvider({
      ...options,
      auditCorrelation: true,
      auditFailurePolicy: "returnDefault",
      auditSink: sink
    });
    const first = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    provider.updateSnapshot?.({ schemaVersion: 1, flags: {} });
    const second = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
    complete[1]?.();
    const secondResult = await second;
    complete[0]?.();
    const firstResult = await first;
    expect(firstResult.value).toBe(true);
    expect(secondResult.value).toBe(false);
    expect(firstResult.flagMetadata?.localProviderAuditEventId).toBe(events[0]?.eventId);
    expect(secondResult.flagMetadata?.localProviderAuditEventId).toBe(events[1]?.eventId);
    expect(events[0]?.snapshotHash).not.toBe(events[1]?.snapshotHash);
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
  });

  it("does not claim SDK success when a later SDK hook rejects the provider response", async () => {
    const outcomes: ProviderAuditOutcome[] = [];
    const provider = createLocalProvider({
      ...options,
      auditCorrelation: true,
      auditFailurePolicy: "returnDefault",
      auditSink: { write: async () => {}, writeConfirmed: async () => {} },
      onAuditOutcome: (outcome) => outcomes.push(outcome)
    });
    const domain = "audit-outcome-hook-boundary";
    await OpenFeature.setProviderAndWait(domain, provider);
    try {
      const details = await OpenFeature.getClient(domain).getBooleanDetails(
        "checkout.enabled",
        false,
        {},
        {
          hooks: [
            {
              after() {
                throw new Error("later SDK hook failed");
              }
            }
          ]
        }
      );
      expect(details).toMatchObject({
        value: false,
        reason: "ERROR",
        errorCode: ErrorCode.GENERAL
      });
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({
        reason: "STATIC",
        writeOutcome: "confirmed",
        auditDefaultApplied: false
      });
    } finally {
      await OpenFeature.clearProviders();
    }
  });

  it("rejects malformed opt-in configuration at construction", () => {
    expect(() => createLocalProvider({ ...options, auditCorrelation: "yes" as never })).toThrow(
      TypeError
    );
    expect(() => createLocalProvider({ ...options, onAuditOutcome: true as never })).toThrow(
      TypeError
    );
  });
});
