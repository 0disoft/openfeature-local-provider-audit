# Optional OpenTelemetry metrics

```ts
// Use the application's existing, configured Meter.
const metrics = createOpenTelemetryMetrics(meter);
const provider = createLocalProvider({ snapshot, metrics });
// provider.onClose() removes this provider's status binding.
```

The package adds no runtime telemetry dependency, global SDK registration, exporter,
network operation, timer or collector. `OpenTelemetryMeter` is a structural subset
of the public Meter interface. Actual API 1.9.1 / metrics SDK 2.12.0 Meter
assignability and collection are tested, using a manual reader without exporters.
The adapter works with a caller-owned meter; choosing and securing its SDK,
resource attributes and destination is the application's responsibility.

## Measurements

| Instrument | Kind / unit | Meaning |
| --- | --- | --- |
| `openfeature.local_provider.evaluations` | Counter / evaluation | Final provider resolutions |
| `openfeature.local_provider.evaluation.errors` | Counter / evaluation | Final resolutions with an error code or ERROR reason |
| `openfeature.local_provider.evaluation.duration` | Histogram / seconds | Provider resolution, including blocking audit wait |
| `openfeature.local_provider.operational` | Observable gauge / item | Current process-local operational counts |
| `openfeature.local_provider.audit.queue.bytes` | Observable gauge / By | Pending bytes and bounded-sink capacity |

The first three use only `type`, `reason`, `source`, `error_code`. Values are
bounded documented enums, `none` or `unknown`; arbitrary values cannot become
labels. No flag key, user/context field, rule ID, variant, provider name, error
message, path, snapshot/override hash or evaluated value becomes a metric label.
SDK-supplied resource/context data is outside this adapter's ownership.

Duration uses the monotonic performance clock and is read only when a
metrics session exists. Non-blocking audit settlement is outside that resolution's
duration. A `returnDefault` audit error is measured as the final ERROR resolution,
not the candidate evaluation. Pure `evaluateFlag` calls are not instrumented.
These are package-specific names, not a claim of OpenTelemetry semantic-convention
conformance. Consumers choose histogram buckets/views and sampling outside the adapter.

The operational gauge has a single bounded `state` label: `providers`, `stale`,
`refresh_successful`, `refresh_failed`, `refresh_consecutive_failures`,
`audit_attempted`, `audit_pending`, `audit_resolved`, `audit_failed`,
`audit_timeouts`, `sink_pending`, `sink_dropped`, `sink_rejected`.
Collection reads current status, so delayed audit completion is visible even with
no further evaluations. Values aggregate providers attached to the same adapter.
Sink counters are counted once per sink object identity within that adapter.
Different wrappers around one backing sink, or separate adapters observing the
same sink, are not deduplicated. Reuse one adapter per meter and sink set.

Operational counts are gauges: closing a provider removes its contribution and
can decrease counts. They are neither durable event totals nor global counters.
Sink counts cover the entire sink, including writers outside the attached
providers. Missing/broken sink diagnostics are omitted. Staleness retains the
operational status wall-clock meaning, not a signature-expiry guarantee.

The queue byte gauge uses only `state: pending | bounded_capacity`. Values aggregate
reported valid sink bytes and finite positive byte limits, with each shared sink
object counted once. Zero is emitted when no matching bytes/finite limits exist;
this replaces previous observable values rather than relying on omission to clear
SDK aggregation state. `bounded_capacity` is the sum for bounded sinks only, never
a total limit for a mixed bounded/unbounded collection.

The item-unit operational gauge additionally reports `sink_byte_limits_unbounded`
and `sink_byte_limits_unknown`. Null limits count as unbounded; missing byte counts,
limits or diagnostics count as unknown. Do not calculate global headroom from
bounded capacity unless both counts are zero. No infinite numeric sample or
sensitive label is emitted. Status may be read once per instrument. Closing the
last binding removes both callbacks; partial registration cleans up both as well.

## Lifecycle and failures

Two observable callbacks are registered at first binding and removed at last close.
Sharing an adapter is supported; close is idempotent and a later provider can bind
again. Providers remove their binding in the close finally path, including when
audit flush fails, without closing the caller-owned meter or other providers.
OpenFeature owns calling provider close; direct users must call it themselves.

Provider binding/recording/cleanup failures do not affect flag results or replace
flush failures. Adapter observation failures are isolated per source/measurement.
Creating instruments can throw at explicit adapter construction, before provider
registration. The caller's custom SDK code remains trusted and synchronous; the
adapter cannot preempt blocking callbacks. Invalid numeric duration is ignored.

The structural integration follows the upstream
[Meter API](https://github.com/open-telemetry/opentelemetry-js/blob/main/api/src/metrics/Meter.ts)
and [Metrics SDK](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/sdk-metrics)
instrument/callback interfaces; tests verify actual collection rather than relying
on those descriptions alone.

Custom integrations may implement `ProviderMetrics.bindStatus(readStatus, sink?)`
returning a `ProviderMetricsSession` with `recordEvaluation(metric)` and `close()`.
They receive only an evaluation category/duration projection, status getter and
optional caller-owned sink reference, not the evaluation request or context.
