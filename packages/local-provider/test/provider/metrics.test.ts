import type { Meter } from "@opentelemetry/api";
import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalProvider,
  createOpenTelemetryMetrics,
  type AuditSink,
  type OpenTelemetryMeter,
  type ProviderEvaluationMetric,
  type ProviderMetrics
} from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const options = { snapshot: staticSnapshot, env: {} };
afterEach(() => vi.restoreAllMocks());

class ManualReader extends MetricReader {
  protected override async onShutdown(): Promise<void> {}
  protected override async onForceFlush(): Promise<void> {}
}

describe("optional metrics", () => {
  it("records and collects through an actual OpenTelemetry Meter without globals or exporters", async () => {
    const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
    const reader = new ManualReader();
    const telemetry = new MeterProvider({ readers: [reader] });
    const meter: Meter = telemetry.getMeter("local-provider-test");
    const metrics = createOpenTelemetryMetrics(meter);
    let fail = false;
    const sink: AuditSink = {
      async write() {
        if (fail) throw new Error("private failure");
      },
      getStats() {
        return { pendingWrites: 3, droppedWrites: 2, rejectedWrites: 1, maxQueueSize: 5 };
      }
    };
    const first = createLocalProvider({
      ...options,
      metrics,
      auditSink: sink,
      auditWriteMode: "blocking",
      staleAfterMs: 1
    });
    const second = createLocalProvider({
      ...options,
      metrics,
      auditSink: sink,
      auditWriteMode: "blocking"
    });
    try {
      await first.resolveBooleanEvaluation(
        "checkout.enabled",
        false,
        { email: "private-user" },
        logger
      );
      fail = true;
      await second.resolveBooleanEvaluation("private-missing-flag", false, {}, logger);
      first.reportRefreshFailure("fetch");
      elapsed.mockReturnValue(10);
      const collected = await reader.collect();
      expect(collected.errors).toEqual([]);
      const data = collected.resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
      const evaluations = data.find((metric) => metric.descriptor.name.endsWith(".evaluations"));
      expect(evaluations?.dataPoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: 1,
            attributes: { type: "boolean", reason: "STATIC", source: "file", error_code: "none" }
          }),
          expect.objectContaining({
            value: 1,
            attributes: {
              type: "boolean",
              reason: "DEFAULT",
              source: "default",
              error_code: "FLAG_NOT_FOUND"
            }
          })
        ])
      );
      const errors = data.find((metric) => metric.descriptor.name.endsWith(".evaluation.errors"));
      expect(errors?.dataPoints).toHaveLength(1);
      const histogram = data.find((metric) =>
        metric.descriptor.name.endsWith(".evaluation.duration")
      );
      expect(histogram?.descriptor.unit).toBe("s");
      expect(histogram?.dataPoints).toHaveLength(2);
      const states = data.find((metric) => metric.descriptor.name.endsWith(".operational"));
      expect(states?.dataPoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ attributes: { state: "providers" }, value: 2 }),
          expect.objectContaining({ attributes: { state: "stale" }, value: 1 }),
          expect.objectContaining({ attributes: { state: "refresh_failed" }, value: 1 }),
          expect.objectContaining({ attributes: { state: "audit_failed" }, value: 1 }),
          expect.objectContaining({ attributes: { state: "sink_dropped" }, value: 2 }),
          expect.objectContaining({ attributes: { state: "sink_pending" }, value: 3 })
        ])
      );
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain("private");
      expect(serialized).not.toContain("checkout.enabled");
      expect(serialized).not.toContain(first.getStatus().snapshotHash);
      await first.onClose?.();
      const remaining = await reader.collect();
      const remainingStates = remaining.resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .find((metric) => metric.descriptor.name.endsWith(".operational"));
      expect(remainingStates?.dataPoints).toContainEqual(
        expect.objectContaining({ attributes: { state: "providers" }, value: 1 })
      );
    } finally {
      await first.onClose?.();
      await second.onClose?.();
      await telemetry.shutdown();
    }
  });

  it("isolates binding, recording and cleanup failures from evaluation and flush errors", async () => {
    const unavailable: ProviderMetrics = {
      bindStatus() {
        throw new Error("meter unavailable");
      }
    };
    const first = createLocalProvider({ ...options, metrics: unavailable });
    await expect(
      first.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({ value: true });
    await first.onClose?.();
    const close = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const recordEvaluation = vi.fn(() => {
      throw new Error("measurement failed");
    });
    const second = createLocalProvider({
      ...options,
      metrics: { bindStatus: () => ({ recordEvaluation, close }) },
      auditSink: {
        write: async () => {},
        flush: async () => {
          throw new Error("flush failed");
        }
      }
    });
    await expect(
      second.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({ value: true });
    expect(recordEvaluation).toHaveBeenCalledOnce();
    await expect(second.onClose?.()).rejects.toThrow("flush failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports the final audit-policy error and includes blocking wait in duration", async () => {
    vi.useFakeTimers();
    const recordEvaluation = vi.fn();
    try {
      const provider = createLocalProvider({
        ...options,
        metrics: { bindStatus: () => ({ recordEvaluation, close() {} }) },
        auditFailurePolicy: "returnDefault",
        auditTimeoutMs: 25,
        auditSink: { write: async () => {}, writeConfirmed: () => new Promise(() => {}) }
      });
      const pending = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);
      await vi.advanceTimersByTimeAsync(25);
      await pending;
      expect(recordEvaluation).toHaveBeenCalledWith({
        requestedType: "boolean",
        reason: "ERROR",
        source: "error",
        errorCode: "AUDIT_SINK_ERROR",
        durationMs: 25
      });
      await provider.onClose?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds dimensions, tolerates faulty instruments and releases shared callbacks", async () => {
    const fixture = testMeter();
    const metrics = createOpenTelemetryMetrics(fixture.meter);
    const provider = createLocalProvider({ ...options });
    const a = metrics.bindStatus(() => provider.getStatus());
    const b = metrics.bindStatus(() => {
      throw new Error("source unavailable");
    });
    expect(fixture.callbacks.size).toBe(1);
    fixture.add.mockImplementation(() => {
      throw new Error("counter failed");
    });
    fixture.record.mockImplementation(() => {
      throw new Error("histogram failed");
    });
    a.recordEvaluation({
      requestedType: "private",
      reason: "private",
      source: "private",
      errorCode: "private",
      durationMs: Number.NaN
    } as unknown as ProviderEvaluationMetric);
    a.recordEvaluation({
      requestedType: "boolean",
      reason: "ERROR",
      source: "error",
      durationMs: 1
    });
    expect(JSON.stringify(fixture.add.mock.calls)).not.toContain("private");
    expect(fixture.record).toHaveBeenCalledOnce();
    const observe = vi.fn(() => {
      throw new Error("observer failed");
    });
    for (const callback of fixture.callbacks) expect(() => callback({ observe })).not.toThrow();
    expect(observe).toHaveBeenCalledTimes(13);
    a.close();
    a.close();
    expect(fixture.callbacks.size).toBe(1);
    b.close();
    expect(fixture.callbacks.size).toBe(0);
    fixture.add.mockClear();
    a.recordEvaluation({
      requestedType: "boolean",
      reason: "STATIC",
      source: "file",
      durationMs: 1
    });
    expect(fixture.add).not.toHaveBeenCalled();
    const restarted = metrics.bindStatus(() => provider.getStatus());
    expect(fixture.callbacks.size).toBe(1);
    restarted.close();
    await provider.onClose?.();
  });
});

function testMeter() {
  type Callback = Parameters<
    ReturnType<OpenTelemetryMeter["createObservableGauge"]>["addCallback"]
  >[0];
  const callbacks = new Set<Callback>();
  const add = vi.fn();
  const record = vi.fn();
  const meter: OpenTelemetryMeter = {
    createCounter: () => ({ add }),
    createHistogram: () => ({ record }),
    createObservableGauge: () => ({
      addCallback(callback) {
        callbacks.add(callback);
      },
      removeCallback(callback) {
        callbacks.delete(callback);
      }
    })
  };
  return { meter, callbacks, add, record };
}
