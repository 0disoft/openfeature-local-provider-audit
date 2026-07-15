# ADR 0010: Bounded Audit Queue Default

Status: Accepted
Owner: 0disoft

## Purpose

Prevent a stalled local audit destination from growing the default non-blocking write
queue until the Node.js process exhausts memory, without silently discarding audit events.

## Source Of Truth

- Product risk: docs/product/03-risk-register.md
- Audit contract: docs/library/audit-event-v1.md
- Performance evidence: docs/engineering/03-performance-budget.md
- Decision benchmark: https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29387834910
- Technical owner: 0disoft

## Evidence

The decision profile ran 1-second, 5-second, and 30-second stalls three times on Ubuntu,
Windows, and macOS. Every one of the 108 scenario results accounted for every requested
write and reported zero failed writes. In the 25,000-write sample, the unbounded queue
reached 25,000 pending writes and sampled about 43 MiB of additional heap. A queue bounded
at 1,000 remained at or below 1,000 pending writes and sampled below 2 MiB on those hosted
runners. Timing and heap values remain environment-dependent evidence, not portable
performance guarantees.

## Decision

- `createFileAuditSink()` uses a default `maxQueueSize` of 5,000.
- The default `queueOverflowPolicy` remains `"reject"`. Overflow rejects the newest
  `write()` promise instead of pretending that the audit event was persisted.
- `maxQueueSize: null` is the explicit opt-out that preserves the pre-0.15 unbounded queue.
- A positive integer still selects a caller-owned queue limit. Zero and negative values
  remain invalid.
- `getStats()` reports pending, dropped, and rejected write counts plus the effective
  queue limit. `maxQueueSize: null` in stats means unbounded.
- Dropped and rejected counters are cumulative for the sink lifetime. `flush()` does not
  reset them.
- Overflow is not retried automatically. A direct sink caller receives the rejection.
  Provider-owned writes keep the evaluated flag result and route the rejection through
  the existing OpenFeature warning path.
- `dropNewest` remains an explicit best-effort choice. The package does not add
  drop-oldest behavior because deleting an already accepted audit event hides ordering
  and evidence loss.

## Compatibility And Migration

This is a compatibility-sensitive pre-1.0 default change released as `0.15.0`.

- Consumers that want the safer default need no option change, but must monitor
  `rejectedWrites` or provider warnings.
- Consumers that intentionally accept process-memory growth to avoid queue overflow must
  set `maxQueueSize: null` before upgrading.
- Consumers with custom `FileAuditSinkStats` fixtures must add `rejectedWrites` and
  `maxQueueSize`.
- Compliance-sensitive consumers should keep `reject`, consider blocking provider audit
  writes, and alert on any rejection. Best-effort diagnostics may select `dropNewest` and
  alert on dropped writes.

## Rejected Alternatives

- Keep the default unbounded: preserves behavior but leaves a demonstrated process-memory
  failure mode as the default.
- Default to 1,000: minimizes memory but rejects bursts substantially smaller than the
  measured 5,000-write short profile.
- Default to `dropNewest`: avoids rejected promises but silently loses audit evidence
  unless every caller polls stats correctly.
- Infer a limit from heap size or file speed: makes behavior host-dependent and difficult
  to replay or document.

## Failure And Recovery

Queue overflow never changes a flag evaluation result. Operators recover by fixing the
audit destination, draining or recreating the sink, increasing the finite limit after
measurement, or explicitly choosing an overflow policy. Short-lived processes must still
flush before successful exit.

## Validation

- Queue tests cover reject, drop-newest, the default limit, and explicit unbounded mode.
- Package tests cover the expanded stats contract.
- Decision-profile artifacts preserve every raw run and aggregate repeated measurements.
- Package, docs, compatibility, and packed-consumer checks remain required by VALIDATION.md.

## Review Blockers

- The default changes without a compatibility note and version review.
- Overflow can occur without a rejected or dropped counter.
- An "unbounded" benchmark omits `maxQueueSize: null`.
- A provider audit overflow changes the evaluated flag value.
