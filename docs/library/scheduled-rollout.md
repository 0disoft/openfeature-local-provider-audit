# Scheduled local rollout

Status: accepted implementation contract under ADR 0015; delivery evidence belongs
to `docs/product/08-privacy-and-portability.md`.

Schema v2 optionally adds flag `schedule: { variant, seed?, stages }`, mutually
exclusive with flag-level `rollout`. `variant` references an existing variant;
seed is a nonempty string of at most 128 characters, defaulting to existing v1
bucketing seed. stages has 1..100 entries `{ at, percentage }`: at is nonnegative
safe-integer epoch milliseconds, strictly increasing; percentage is 0..100 with
at most three decimals and is nondecreasing. Configuration is copied and frozen.
Schema v1 rejects this field. Old v2 snapshots without it retain their behavior.

## Time and precedence

Pure evaluation, explanation, replay and CLI requests use optional `evaluationTime`
in epoch milliseconds. A reached schedule requires a nonnegative safe integer and
a nonempty targetingKey, otherwise returns caller default/INVALID_CONTEXT. No
ambient clock is read by the pure evaluator. Unsheduled flags ignore evaluationTime.

Provider option `clock?: () => number` defaults to Date.now. A scheduled flag
captures it once per evaluation; context fields cannot supply a trusted clock.
Throwing/invalid clocks become invalid time if the schedule is reached. Existing
flag/type checks, emergency disabledVariant, override errors/values and first-match
targeting rules precede the flag schedule. Ordinary unscheduled evaluations perform
no new clock work. Constructing a provider starts no timer, watcher or worker.

The active stage is the last with at <= evaluationTime. Before the first stage,
percentage is zero. One existing deterministic bucket for flag/key/seed is compared
with percentage * 1,000. Selected users receive schedule.variant/SPLIT; other users
receive flag.defaultVariant/STATIC. Increasing the percentage preserves earlier
membership with the same flag/key/seed. A final stage remains active indefinitely.

Time is stateless wall time: a backwards clock or an explicitly earlier replay
time can select an earlier stage. The library does not persist a time floor or
silently clamp time. Applications requiring monotonic progression own their trusted
clock; emergency stop and signed higher-sequence configuration rollback remain
available. Clock changes do not mutate the snapshot or emit configuration events.

## Audit, replay and offline inspection

When a schedule is reached successfully, result/explanation/audit/replay metadata
`schedule: { evaluatedAt, stage, percentage }` records the exact input time, a
zero-based stage index (null before first stage) and effective percentage. No raw
context or identifier is added. Chain verification strictly validates and hashes
these fields. Existing chain bytes without schedule metadata are unchanged; older
alpha verifiers reject new fields, so opt-in writers/verifiers upgrade together.

Offline evaluate/explain/simulate/compare accept per-request evaluationTime. Replay
uses that same request field and compares schedule metadata as part of the decision.
Use fixed times for before/at/after stage simulations. Snapshots and audit timestamps
alone cannot reproduce an arbitrary caller-supplied clock; retain this decision
metadata with sanitized replay fixtures. Older snapshots/replay results remain valid.

Detailed tests must prove boundary times, monotone cohort expansion, stable seeds,
before-first/final stage, clock rollback, override/emergency/targeting priority,
invalid schema/clock/context, SDK/audit/chain and offline replay/CLI composition.
Existing Node 22/24 and packaged ESM/CJS/type contracts remain required. This slice
does not add remote scheduling, delayed jobs or automatic publication.
