# Performance Checklist

Status: Draft

## Failure Modes

Latency regression, oversized payloads, excess queries, missing cache policy, bundle growth, background job pressure, and hot-path churn.

## Checklist

- The affected user journey or hot path is named.
- Latency, payload, query count, cache, bundle, or job budget is stated or marked UNDECIDED.
- Repeated I/O, cross-boundary calls, and avoidable allocations are reviewed.
- Cache behavior includes invalidation, freshness, and fallback expectations.
- Performance validation evidence or a reason for skipping it is included.

## Validation

- Required validation names: test, smoke, check
- Skipped validation must include a reason and remaining risk.
