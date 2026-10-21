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
      sink_rejected: 0
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
        if (binding.sink !== undefined && !seenSinks.has(binding.sink) && status.audit.sinkStats) {
          seenSinks.add(binding.sink);
          counts.sink_pending += status.audit.sinkStats.pendingWrites;
          counts.sink_dropped += status.audit.sinkStats.droppedWrites;
          counts.sink_rejected += status.audit.sinkStats.rejectedWrites;
        }
      } catch {
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

  return {
    bindStatus(read, sink) {
      if (bindings.size === 0) operational.addCallback(collect);
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
          if (bindings.size === 0) operational.removeCallback(collect);
        }
      };
    }
  };
}

function bounded(allowed: ReadonlySet<string>, value: string): string {
  return allowed.has(value) ? value : "unknown";
}
