import { cleanupResources } from "../errors/resource-cleanup.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import type {
  AuditSink,
  OpenTelemetryMeter,
  ProviderMetrics,
  ProviderStatus
} from "../public-types.js";

const TYPES = new Set<string>(["boolean", "string", "number", "object"]);
const REASONS = new Set<string>(Object.values(EVALUATION_REASONS));
const SOURCES = new Set<string>(Object.values(EVALUATION_SOURCES));
const ERRORS = new Set<string>(Object.values(LOCAL_PROVIDER_ERROR_CODES));
const PREFIX = "openfeature.local_provider";

interface Binding {
  readonly read: () => ProviderStatus;
  readonly sink: AuditSink | undefined;
}

/** Uses a caller-owned Meter; never installs an SDK, exporter, timer or global provider. */
export function createOpenTelemetryMetrics(meter: OpenTelemetryMeter): ProviderMetrics {
  const evaluations = meter.createCounter(`${PREFIX}.evaluations`, { unit: "{evaluation}" });
  const errors = meter.createCounter(`${PREFIX}.evaluation.errors`, { unit: "{evaluation}" });
  const duration = meter.createHistogram(`${PREFIX}.evaluation.duration`, { unit: "s" });
  const operational = meter.createObservableGauge(`${PREFIX}.operational`, { unit: "{item}" });
  const queueBytes = meter.createObservableGauge(`${PREFIX}.audit.queue.bytes`, { unit: "By" });
  const bindings = new Set<Binding>();

  const collect: Parameters<typeof operational.addCallback>[0] = (result) => {
    const counts = {
      providers: 0,
      stale: 0,
      refresh_successful: 0,
      refresh_failed: 0,
      refresh_consecutive_failures: 0,
      audit_attempted: 0,
      audit_pending: 0,
      audit_resolved: 0,
      audit_failed: 0,
      audit_timeouts: 0,
      sink_pending: 0,
      sink_dropped: 0,
      sink_rejected: 0,
      sink_byte_limits_unbounded: 0,
      sink_byte_limits_unknown: 0
    };
    const seenSinks = new Set<AuditSink>();
    for (const binding of bindings) {
      try {
        const status = binding.read();
        counts.providers++;
        counts.stale += Number(status.stale);
        counts.refresh_successful += status.successfulRefreshes;
        counts.refresh_failed += status.failedRefreshes;
        counts.refresh_consecutive_failures += status.consecutiveRefreshFailures;
        counts.audit_attempted += status.audit.attemptedWrites;
        counts.audit_pending += status.audit.pendingWrites;
        counts.audit_resolved += status.audit.resolvedWrites;
        counts.audit_failed += status.audit.failedWrites;
        counts.audit_timeouts += status.audit.timedOutWrites;
        if (binding.sink !== undefined && !seenSinks.has(binding.sink)) {
          seenSinks.add(binding.sink);
          const stats = status.audit.sinkStats;
          if (stats !== undefined) {
            counts.sink_pending += stats.pendingWrites;
            counts.sink_dropped += stats.droppedWrites;
            counts.sink_rejected += stats.rejectedWrites;
          }
          if (stats?.maxQueueBytes === null) counts.sink_byte_limits_unbounded++;
          if (stats?.maxQueueBytes === undefined || stats.pendingBytes === undefined)
            counts.sink_byte_limits_unknown++;
        }
      } catch {
        if (binding.sink !== undefined && !seenSinks.has(binding.sink)) {
          seenSinks.add(binding.sink);
          counts.sink_byte_limits_unknown++;
        }
        // A faulty diagnostic source cannot prevent collection from other providers.
      }
    }
    for (const [state, value] of Object.entries(counts)) {
      try {
        if (Number.isFinite(value) && value >= 0) result.observe(value, { state });
      } catch {
        // A custom observer must not abort other operational measurements.
      }
    }
  };

  const collectBytes: Parameters<typeof queueBytes.addCallback>[0] = (result) => {
    let pending = 0;
    let capacity = 0;
    const seen = new Set<AuditSink>();
    for (const binding of bindings) {
      if (binding.sink === undefined || seen.has(binding.sink)) continue;
      seen.add(binding.sink);
      try {
        const stats = binding.read().audit.sinkStats;
        if (
          stats?.pendingBytes !== undefined &&
          Number.isSafeInteger(stats.pendingBytes) &&
          stats.pendingBytes >= 0
        )
          pending += stats.pendingBytes;
        const limit = stats?.maxQueueBytes;
        if (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0)
          capacity += limit;
      } catch {
        /* Faulty diagnostics do not prevent collection from other sinks. */
      }
    }
    for (const [state, value] of [
      ["pending", pending],
      ["bounded_capacity", capacity]
    ] as const) {
      if (!Number.isSafeInteger(value)) continue;
      try {
        result.observe(value, { state });
      } catch {
        /* Optional instrumentation; isolate each measurement. */
      }
    }
  };
  function releaseGauges(failure?: { cause: unknown }): void {
    cleanupResources(
      [() => operational.removeCallback(collect), () => queueBytes.removeCallback(collectBytes)],
      "Metric callback cleanup failed.",
      failure
    );
  }

  return {
    bindStatus(read, sink) {
      if (bindings.size === 0) {
        try {
          operational.addCallback(collect);
          queueBytes.addCallback(collectBytes);
        } catch (cause) {
          releaseGauges({ cause });
          throw cause;
        }
      }
      const binding: Binding = { read, sink };
      bindings.add(binding);
      let closed = false;
      return {
        recordEvaluation(metric) {
          if (closed) return;
          const attributes = Object.freeze({
            type: bounded(TYPES, metric.requestedType),
            reason: bounded(REASONS, metric.reason),
            source: bounded(SOURCES, metric.source),
            error_code: metric.errorCode === undefined ? "none" : bounded(ERRORS, metric.errorCode)
          });
          try {
            evaluations.add(1, attributes);
          } catch {
            /* Optional instrumentation. */
          }
          try {
            if (metric.errorCode !== undefined || metric.reason === EVALUATION_REASONS.ERROR) {
              errors.add(1, attributes);
            }
          } catch {
            /* Optional instrumentation. */
          }
          try {
            if (Number.isFinite(metric.durationMs) && metric.durationMs >= 0) {
              duration.record(metric.durationMs / 1_000, attributes);
            }
          } catch {
            /* Optional instrumentation. */
          }
        },
        close() {
          if (closed) return;
          closed = true;
          bindings.delete(binding);
          if (bindings.size === 0) releaseGauges();
        }
      };
    }
  };
}

function bounded(allowed: ReadonlySet<string>, value: string): string {
  return allowed.has(value) ? value : "unknown";
}
