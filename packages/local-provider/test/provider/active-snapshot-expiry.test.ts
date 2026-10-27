import { ErrorCode, OpenFeature, ProviderEvents } from "@openfeature/server-sdk";
import { afterEach, expect, it, vi } from "vitest";
import {
  createAuditEvent,
  createLocalProvider,
  createReloadableLocalProvider,
  type AuditEvent,
  type ProviderAuditOutcome,
  type ProviderEvaluationMetric,
  type SignedSnapshotMetadata,
  type FlagSnapshot,
  type SnapshotExpiryPolicy
} from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const request = {
  flagKey: "checkout.enabled",
  expectedType: "boolean" as const,
  defaultValue: false
};
const hash = createAuditEvent({
  snapshot: staticSnapshot,
  request,
  result: {
    flagKey: request.flagKey,
    value: true,
    reason: "STATIC",
    source: "file",
    flagMetadata: {}
  },
  providerName: "test"
}).snapshotHash;
function origin(extra: Partial<SignedSnapshotMetadata> = {}): SignedSnapshotMetadata {
  return {
    keyId: "test",
    audience: "expiry/test",
    sequence: 1,
    issuedAt: 0,
    expiresAt: 1000,
    artifactHash: "a".repeat(64),
    snapshotHash: hash,
    ...extra
  };
}
const options = {
  snapshot: staticSnapshot,
  provenance: origin(),
  env: {},
  snapshotExpiryPolicy: "returnDefault" as const
};
afterEach(() => vi.restoreAllMocks());

it.each([undefined, "continue"] as const)(
  "preserves default last-good behavior for policy %s",
  async (policy) => {
    const clock = vi.fn(() => {
      throw new Error("must not read unscheduled clock");
    });
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      provenance: origin(),
      env: {},
      clock,
      ...(policy === undefined ? {} : { snapshotExpiryPolicy: policy })
    });
    expect(
      (await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value
    ).toBe(true);
    expect(clock).not.toHaveBeenCalled();
  }
);

for (const [factoryName, factory] of [
  ["fixed", createLocalProvider],
  ["reloadable", createReloadableLocalProvider]
] as const) {
  it.each([999, 1000, 1001])(`${factoryName} enforces exact expiry at %s`, async (now) => {
    const provider = factory({ ...options, clock: () => now });
    const result = await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger);
    expect(result.value).toBe(now < 1000);
    expect(result.errorCode).toBe(now < 1000 ? undefined : ErrorCode.PROVIDER_NOT_READY);
    expect(result.reason).toBe(now < 1000 ? "STATIC" : "ERROR");
    if (now >= 1000) {
      expect(result.variant).toBeUndefined();
      expect(result.flagMetadata).toEqual({});
    }
  });
}

it("uses each typed caller default and never mutates an object default", async () => {
  const provider = createLocalProvider({ ...options, clock: () => 1000 });
  expect(
    (await provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)).value
  ).toBe(false);
  expect(
    (await provider.resolveStringEvaluation("checkout.copy", "fallback", {}, logger)).value
  ).toBe("fallback");
  expect((await provider.resolveNumberEvaluation("checkout.limit", 42, {}, logger)).value).toBe(42);
  const fallback = { nested: [1] };
  expect(
    (await provider.resolveObjectEvaluation("checkout.config", fallback, {}, logger)).value
  ).toBe(fallback);
  fallback.nested.push(2);
  expect(fallback.nested).toEqual([1, 2]);
});

it("blocks overrides and flag lookup after expiry without altering freshness counters", async () => {
  const provider = createLocalProvider({
    ...options,
    clock: () => 1000,
    overridesJson: '{"checkout.enabled":true}',
    staleAfterMs: 100000
  });
  const before = provider.getStatus();
  for (const flagKey of [request.flagKey, "missing"])
    expect(await provider.resolveBooleanEvaluation(flagKey, false, {}, logger)).toMatchObject({
      value: false,
      errorCode: ErrorCode.PROVIDER_NOT_READY
    });
  expect(provider.getStatus().successfulRefreshes).toBe(before.successfulRefreshes);
  expect(provider.getStatus().failedRefreshes).toBe(before.failedRefreshes);
  expect(provider.getStatus().provenance).toEqual(before.provenance);
});

it.each([Number.NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  "fails closed on invalid clock %s",
  async (now) => {
    expect(
      await createLocalProvider({ ...options, clock: () => now }).resolveBooleanEvaluation(
        request.flagKey,
        false,
        {},
        logger
      )
    ).toMatchObject({ value: false, errorCode: ErrorCode.PROVIDER_NOT_READY });
  }
);

it("isolates a throwing clock, which may recover before expiry", async () => {
  const clock = vi.fn<() => number>(() => {
    throw new Error("private clock fault");
  });
  const provider = createLocalProvider({ ...options, clock });
  expect(
    (await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).errorCode
  ).toBe(ErrorCode.PROVIDER_NOT_READY);
  clock.mockReturnValue(999);
  expect((await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value).toBe(
    true
  );
});

it("does not revive an observed expired artifact after rollback or an unchanged update", async () => {
  let now = 1000;
  const provider = createReloadableLocalProvider({ ...options, clock: () => now });
  expect((await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value).toBe(
    false
  );
  now = 0;
  for (const snapshot of [provider.getSnapshot(), structuredClone(staticSnapshot)]) {
    provider.updateSnapshot(snapshot, origin());
    expect(
      (await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).errorCode
    ).toBe(ErrorCode.PROVIDER_NOT_READY);
  }
});

it("renews same-content signed provenance atomically without configuration events", async () => {
  let now = 1000;
  const provider = createReloadableLocalProvider({ ...options, clock: () => now });
  const changed = vi.fn();
  provider.events?.addHandler(ProviderEvents.ConfigurationChanged, changed);
  await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger);
  const renewed = origin({ sequence: 2, expiresAt: 2000, artifactHash: "b".repeat(64) });
  const cancelled = provider.prepareSnapshot?.(provider.getSnapshot(), renewed);
  cancelled?.cancel();
  expect((await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value).toBe(
    false
  );
  const transaction = provider.prepareSnapshot?.(provider.getSnapshot(), renewed);
  transaction?.commit();
  expect((await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value).toBe(
    true
  );
  now = 2000;
  expect((await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value).toBe(
    false
  );
  expect(changed).not.toHaveBeenCalled();
});

it("leaves unsigned bootstrap and explicit unsigned updates outside signed expiry", async () => {
  const clock = vi.fn(() => 1000);
  const provider = createReloadableLocalProvider({ ...options, clock });
  await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger);
  provider.updateSnapshot(provider.getSnapshot());
  clock.mockClear();
  expect((await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).value).toBe(
    true
  );
  expect(provider.getStatus().provenance).toBeUndefined();
  expect(clock).not.toHaveBeenCalled();
});

it.each(["blocking", "nonBlocking"] as const)(
  "rechecks expiry after %s audit work and correlates the final default",
  async (auditWriteMode) => {
    let now = 999;
    const events: AuditEvent[] = [],
      outcomes: ProviderAuditOutcome[] = [];
    const metrics: ProviderEvaluationMetric[] = [];
    const provider = createLocalProvider({
      ...options,
      clock: () => now,
      auditWriteMode,
      auditCorrelation: true,
      metrics: {
        bindStatus() {
          return {
            recordEvaluation(metric) {
              metrics.push(metric);
            },
            close() {}
          };
        }
      },
      auditSink: {
        async write(event) {
          events.push(event);
          now = 1000;
        }
      },
      onAuditOutcome(outcome) {
        outcomes.push(outcome);
      }
    });
    const result = await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger);
    expect(result).toMatchObject({ value: false, errorCode: ErrorCode.PROVIDER_NOT_READY });
    expect(events).toHaveLength(1);
    expect(metrics).toMatchObject([{ reason: "ERROR", errorCode: "PROVIDER_NOT_READY" }]);
    expect(events[0]?.reason).toBe("STATIC");
    expect(result.flagMetadata?.localProviderAuditEventId).toBe(events[0]?.eventId);
    expect(outcomes[0]).toMatchObject({
      reason: "ERROR",
      errorCode: "PROVIDER_NOT_READY",
      auditDefaultApplied: false
    });
    await provider.onClose?.();
  }
);

it("checks the captured old artifact even when a fresh snapshot replaces it while audit is pending", async () => {
  let now = 999,
    finish: (() => void) | undefined;
  const provider = createReloadableLocalProvider({
    ...options,
    clock: () => now,
    auditWriteMode: "blocking",
    auditSink: {
      write: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    }
  });
  const pending = provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger);
  now = 1000;
  provider.updateSnapshot(
    provider.getSnapshot(),
    origin({ expiresAt: 2000, artifactHash: "b".repeat(64), sequence: 2 })
  );
  expect(finish).toBeTypeOf("function");
  finish?.();
  expect((await pending).value).toBe(false);
  await provider.onClose?.();
});

it("preserves an audit-failure default instead of changing its error precedence", async () => {
  let now = 999;
  const provider = createLocalProvider({
    ...options,
    clock: () => now,
    auditFailurePolicy: "returnDefault",
    auditSink: {
      async write() {},
      async writeConfirmed() {
        now = 1000;
        throw new Error("storage");
      }
    }
  });
  expect(await provider.resolveBooleanEvaluation(request.flagKey, false, {}, logger)).toMatchObject(
    { value: false, errorCode: ErrorCode.GENERAL }
  );
  await provider.onClose?.();
});

it("returns expiry defaults through actual OpenFeature client details", async () => {
  const domain = "active-expiry";
  await OpenFeature.setProviderAndWait(
    domain,
    createLocalProvider({ ...options, clock: () => 1000 })
  );
  try {
    expect(
      await OpenFeature.getClient(domain).getBooleanDetails(request.flagKey, false)
    ).toMatchObject({ value: false, reason: "ERROR", errorCode: ErrorCode.PROVIDER_NOT_READY });
  } finally {
    await OpenFeature.clearProviders();
  }
});

it("rejects unsupported expiry policy values before provider creation", () => {
  expect(() =>
    createLocalProvider({
      ...options,
      snapshotExpiryPolicy: "reject" as SnapshotExpiryPolicy
    })
  ).toThrow("snapshotExpiryPolicy");
});

it("shares the initial trusted clock with scheduled evaluation and rechecks before observations", async () => {
  const snapshot: FlagSnapshot = {
    schemaVersion: 2,
    flags: {
      feature: {
        type: "boolean",
        variants: { on: true, off: false },
        defaultVariant: "off",
        schedule: { seed: "expiry", variant: "on", stages: [{ at: 0, percentage: 100 }] }
      }
    }
  };
  const req = {
    flagKey: "feature",
    expectedType: "boolean" as const,
    defaultValue: false,
    targetingKey: "subject"
  };
  const snapshotHash = createAuditEvent({
    snapshot,
    request: req,
    result: { ...req, value: true, reason: "STATIC", source: "file", flagMetadata: {} },
    providerName: "test"
  }).snapshotHash;
  const clock = vi.fn().mockReturnValueOnce(999).mockReturnValueOnce(1000);
  const provider = createLocalProvider({
    ...options,
    snapshot,
    provenance: origin({ snapshotHash }),
    clock
  });
  expect(
    await provider.resolveBooleanEvaluation(
      "feature",
      false,
      { targetingKey: "subject", evaluationTime: 0 },
      logger
    )
  ).toMatchObject({ value: false, errorCode: ErrorCode.PROVIDER_NOT_READY });
  expect(clock).toHaveBeenCalledTimes(2);
});
