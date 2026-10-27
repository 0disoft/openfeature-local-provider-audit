# Scheduled local rollout

Status: implemented locally in unpublished alpha.16 under ADR 0015; delivery evidence belongs
to `docs/product/08-privacy-and-portability.md`.

Schema v2 optionally adds flag `schedule: { variant, seed?, stages }`, mutually
exclusive with flag-level `rollout`. `variant` references an existing variant;
seed is a nonempty string of at most 128 characters, defaulting to existing v1
bucketing seed. stages has 1..100 entries `{ at, percentage }`: at is nonnegative
safe-integer epoch milliseconds, strictly increasing; percentage is 0..100 with
at most three decimals and is nondecreasing. Configuration is copied and frozen.
Schema v1 rejects this field. Old v2 snapshots without it retain their behavior.
Ordinary and scheduled rollouts share a magnitude-aware floating-point tolerance:
valid decimals such as 2.01 and 65.005 are accepted without rounding the stored
percentage or changing the existing integer bucket threshold.
Older alpha providers reject schedule fields; upgrade consumers before delivering
scheduled snapshots. Reverting to schedule-free configuration restores the old path.

## Time and precedence

Pure evaluation, explanation, replay and CLI requests use optional `evaluationTime`
in epoch milliseconds. A reached schedule requires a nonnegative safe integer and
a nonempty targetingKey, otherwise returns caller default/INVALID_CONTEXT. No
ambient clock is read by the pure evaluator. Unscheduled flags ignore evaluationTime.

Provider option `clock?: () => number` defaults to Date.now. A scheduled flag
captures it once per evaluation; context fields cannot supply a trusted clock.
Opt-in active signed expiry shares that initial timestamp and separately rechecks
successful candidates after audit waiting, before final observations. The schedule
decision still uses the initial timestamp; see `active-snapshot-expiry.md`.
Throwing/invalid clocks become invalid time if the schedule is reached. Existing
flag/type checks, emergency disabledVariant, override errors/values and first-match
targeting rules precede the flag schedule. Ordinary unscheduled evaluations perform
no new clock work. Constructing a provider starts no timer, watcher or worker.

The active stage is the last with at <= evaluationTime. Before the first stage,
percentage is zero. One existing deterministic bucket for flag/key/seed is compared
with percentage * 1,000. Selected users receive schedule.variant/SPLIT; other users
receive flag.defaultVariant/STATIC. Increasing the percentage preserves earlier
membership with the same flag/key/seed. A final stage remains active indefinitely.

For validator-owned immutable snapshots, schedules with at least 16 stages use
binary search over their strictly increasing times: at most seven time comparisons
for the supported 100-stage maximum. Smaller schedules and caller-owned snapshots
retain sequential lookup; freezing a caller's object alone does not establish
validated ordering. Selection remains stateless and adds no cache or timer.

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
