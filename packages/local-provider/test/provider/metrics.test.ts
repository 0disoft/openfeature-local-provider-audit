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
  it("cleans both gauges after partial registration and cleanup failures", async () => {
    const fixture = testMeter();
    const metrics = createOpenTelemetryMetrics(fixture.meter);
    const provider = createLocalProvider(options);
    const failure = new Error("registration failed");
    fixture.register
      .mockImplementationOnce((callback) => {
        fixture.callbacks.add(callback);
      })
      .mockImplementationOnce(() => {
        throw failure;
      });
    expect(() => metrics.bindStatus(() => provider.getStatus())).toThrow(failure);
    expect(fixture.callbacks.size).toBe(0);
    const session = metrics.bindStatus(() => provider.getStatus());
    const cleanupFailure = new Error("remove failed");
    fixture.remove.mockImplementationOnce((callback) => {
      fixture.callbacks.delete(callback);
      throw cleanupFailure;
    });
    expect(() => session.close()).toThrow(cleanupFailure);
    expect(fixture.callbacks.size).toBe(0);
    expect(() => session.close()).not.toThrow();
    await provider.onClose?.();
  });

  it("reports unknown byte limits and isolates faulty shared diagnostics", async () => {
    const fixture = testMeter();
    const metrics = createOpenTelemetryMetrics(fixture.meter);
    const provider = createLocalProvider(options);
    const legacy: AuditSink = { async write() {} };
    const broken: AuditSink = { async write() {} };
    const a = metrics.bindStatus(() => provider.getStatus(), legacy);
    const b = metrics.bindStatus(() => provider.getStatus(), legacy);
    const c = metrics.bindStatus(() => {
      throw new Error("status failed");
    }, broken);
    const observe = vi.fn();
    for (const callback of fixture.callbacks) callback({ observe });
    expect(observe).toHaveBeenCalledWith(2, { state: "sink_byte_limits_unknown" });
    expect(observe).toHaveBeenCalledWith(0, { state: "pending" });
    expect(observe).toHaveBeenCalledWith(0, { state: "bounded_capacity" });
    a.close();
    b.close();
    c.close();
    await provider.onClose?.();
  });

  it("records and collects through an actual OpenTelemetry Meter without globals or exporters", async () => {
    const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
    const reader = new ManualReader();
    const telemetry = new MeterProvider({ readers: [reader] });
    const meter: Meter = telemetry.getMeter("local-provider-test");
    const metrics = createOpenTelemetryMetrics(meter);
    let fail = false;
    let capacity: number | null = 64;
    const sink: AuditSink = {
      async write() {
        if (fail) throw new Error("private failure");
      },
      getStats() {
        return {
          pendingWrites: 3,
          droppedWrites: 2,
          rejectedWrites: 1,
          maxQueueSize: 5,
          pendingBytes: 17,
          maxQueueBytes: capacity
        };
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
      const bytes = data.find((metric) => metric.descriptor.name.endsWith(".audit.queue.bytes"));
      expect(bytes?.descriptor.unit).toBe("By");
      expect(bytes?.dataPoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ attributes: { state: "pending" }, value: 17 }),
          expect.objectContaining({ attributes: { state: "bounded_capacity" }, value: 64 })
        ])
      );
      capacity = null;
      const unlimited = await reader.collect();
      const unlimitedBytes = unlimited.resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .find((metric) => metric.descriptor.name.endsWith(".audit.queue.bytes"));
      expect(unlimitedBytes?.dataPoints).toHaveLength(2);
      expect(unlimitedBytes?.dataPoints).toContainEqual(
        expect.objectContaining({ attributes: { state: "bounded_capacity" }, value: 0 })
      );
      const unlimitedStates = unlimited.resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .find((metric) => metric.descriptor.name.endsWith(".operational"));
      expect(unlimitedStates?.dataPoints).toContainEqual(
        expect.objectContaining({ attributes: { state: "sink_byte_limits_unbounded" }, value: 1 })
      );
      expect(unlimitedBytes?.dataPoints[0]).toMatchObject({
        attributes: { state: "pending" },
        value: 17
      });
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
    expect(fixture.callbacks.size).toBe(2);
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
    expect(observe).toHaveBeenCalledTimes(17);
    a.close();
    a.close();
    expect(fixture.callbacks.size).toBe(2);
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
    expect(fixture.callbacks.size).toBe(2);
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
  const register = vi.fn((callback: Callback) => {
    callbacks.add(callback);
  });
  const remove = vi.fn((callback: Callback) => {
    callbacks.delete(callback);
  });
  const meter: OpenTelemetryMeter = {
    createCounter: () => ({ add }),
    createHistogram: () => ({ record }),
    createObservableGauge: () => ({
      addCallback: register,
      removeCallback: remove
    })
  };
  return { meter, callbacks, add, record, register, remove };
}
