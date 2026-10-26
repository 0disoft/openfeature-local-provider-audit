# Flag snapshot schema v2

Status: Accepted contract; implementation delivered in the P1 slices.
Source: ADR 0013. JSON and YAML share this contract.

V2 retains all v1 fields and adds `rules`, `disabledVariant` and optional `schedule` to flag definitions.
`schemaVersion: 2` is required for those fields. V1 stays supported and rejects them.
Snapshot, flag, rule and condition objects reject unknown fields. Validation clones
and freezes accepted input. Existing value and rollout validation still applies.

## Conditions and rules

Rules are ordered, at most 100 per flag. Each has a unique non-empty `id` of at most
128 characters, a `when` condition, and exactly one of `variant` or `rollout`.
Variant references must exist. Variant names and references do not inherit the
128-character rule-ID limit; the existing nonblank-name contract and input limits
remain in effect. Rollouts contain at most 100 entries in v2 and retain
v1 percentage precision, sum, seed, and variant requirements.

Leaf conditions have `attribute` (an array of 1..8 non-empty path segments, each at
most 128 characters), `op`, and `value`. Paths access only own data properties; no
getters, inherited fields, or `__proto__`, `prototype`, `constructor` segments.
`targetingKey` as a single segment uses the explicit evaluation targeting key first,
otherwise an own context property. No context normalization or GeoIP lookup occurs.

- `eq`: strict equality with a string, finite number, boolean, or null.
- `in`: array of 1..100 such scalars, strict equality without coercion.
- `gt`, `gte`, `lt`, `lte`: finite numeric operands only.
- `semverEq`, `semverGt`, `semverGte`, `semverLt`, `semverLte`: strict valid semantic
  version strings, including prerelease precedence; build metadata does not affect
  precedence. No ranges or leading-v normalization. Runtime values must also be valid.
- `{ all: [condition, ...] }` / `{ any: [condition, ...] }`: non-empty groups of at
  most 20 children. Each rule is limited to 8 levels and 100 condition nodes.

Group dispatch uses only own `all`/`any` fields, matching the validator. Inherited
arrays/getters are ignored, including fields introduced on `Object.prototype`
after validation; they cannot turn a leaf into a group or shadow its actual group.
This prevents false matches from inherited empty `all` arrays and false negatives
from inherited empty `any` arrays without invoking inherited getters. Each visited
node uses at most two O(1) own-property checks; rule/group order and short circuit
behavior are preserved in Node and portable core. This limited dispatch guarantee
does not provide process-wide protection against arbitrary prototype mutation.

Condition strings and runtime comparison strings are limited to 4,096 characters;
SemVer strings are at most 256 characters. Missing, accessor, inherited, oversized,
non-finite, or wrong-type context values do not match. Missing is distinct from null.
Cycles and large unrelated context fields are never traversed.

Wide `in` arrays from validated snapshots use a private membership index; smaller
arrays retain linear lookup. Validation creates and freezes its own operand copy,
preserving its order and duplicates in the snapshot and hash. The index is keyed
weakly by that array, contains configuration operands only and never retains context
or targeting values. It is not serialized or exposed in explanations. Direct caller
arrays (including caller-frozen arrays that bypass validation) retain live strict
equality, avoiding stale caches or a changed NaN comparison. Rule/group order and
short-circuit behavior are unchanged in Node and the portable core.

SemVer comparisons reuse a private parsed operand per condition when the operand
string is unchanged. A changed caller-owned operand replaces its weakly keyed entry,
including transitions to/from invalid versions. Discarded snapshots are not retained.

Each evaluation reads the current own-data attribute for every visited leaf. Within
that synchronous evaluation, a private two-entry slot reuses the two most recent
actual strings (up to the existing 256-character parsing limit) and their parsed
results, including invalid results. It is shared across visited groups/rules, then discarded: context
objects/requests are not cache keys, no actual versions enter a global cache, and
changes in a reused request are read again on the next evaluation. A third distinct
string evicts the older entry rather than accumulating entries, so added storage
is O(1).

For N visited comparisons with the same actual version and already cached operands,
actual-version parsing/construction falls from N to 1. Rule traversal remains O(N);
two alternating actual strings construct at most two parsed actual versions, while
cycling through three distinct strings may still parse N times. Strict parsing,
prerelease/build precedence, own-property reads, rule/group order and short circuit behavior are
unchanged in Node and portable core. The existing `benchmark:evaluation` script adds
1-/100-rule valid and invalid version workloads; setup and operand warmup are outside
timing. Its developer-machine samples are not production throughput guarantees.

A local Node 24.14.0 / Windows comparison of 5,000 evaluations over 100 false rules,
alternating `2.1.0` and `3.0.0`, measured five warmed rounds. Median Node full-entry
time was 288.21 -> 94.33 ms; the portable core running on Node was 285.67 -> 89.38 ms.
Single-version controls were 84.58 -> 85.12 ms and 83.34 -> 84.06 ms respectively.
Setup and operand warmup were outside timing, and all decisions stayed unchanged.
These are local CPU samples, not production latency or non-Node runtime evidence.

## Selection and failure

After flag existence and requested type checks, `disabledVariant` immediately selects
that existing variant with reason `DISABLED`, bypassing overrides and targeting.
Removing it restores normal selection. V1 override behavior is unchanged.

Optional flag selection policies (`disabledVariant`, `rules`, `schedule`, `rollout`),
rule direct variants, rollout/schedule seeds, computed optional variants, flag metadata
and global override errors use own-property reads. Inherited values/getters introduced
on a host prototype after validation do not become configuration. Missing seeds keep
`v1`; missing variant selections still fall back to the configured default. Explicit
own fields retain precedence, and v1/v2 rule order, bucket hashes, configuration hashes
and public object prototypes/signatures remain unchanged in Node and portable core.
A local regression changes `Object.prototype.disabledVariant` to `on`: formerly the
same frozen snapshot/hash changed from false/STATIC to true/DISABLED; it now retains
false/STATIC. Other tests cover injected policy arrays, getters, seeds, unallocated
buckets, targeting rollout discrimination and metadata. Each guarded field read adds
one O(1) own-property check; no context cache, snapshot copy or I/O is introduced.
This does not prevent unrelated prototype mutation elsewhere in the host process.

Otherwise overrides precede rules. First matching rule wins. A direct selection uses
`TARGETING_MATCH`. A rule rollout selection uses `SPLIT`; an unallocated bucket uses
`TARGETING_MATCH` with the flag default variant. A matched rollout lacking a usable
targeting key returns caller default with `ERROR` / `INVALID_CONTEXT`, never another
rule. Nonmatching rules fall through to the original top-level rollout/static path.

`EvaluationResult.ruleId` identifies the selected rule. Reasons/sources and optional
rule ID reach OpenFeature details (`localProviderRuleId` metadata, provider-owned),
audit records and replay. No context values or rule operands are added to audit.
Rule IDs, flag/variant names and metadata are caller-controlled and must not contain
personal data or secrets. Flags are not authorization or tenant isolation boundaries.

Percentage expansion preserves buckets when flag key, targeting key, seed, and the
start of the variant interval stay fixed. Reordering variants or changing a seed can
reassign users; no universal monotonicity claim is made for arbitrary multi-variant
changes. ADR 0015 adds the opt-in bounded `schedule` contract in
`scheduled-rollout.md`, after first-match rules and before static fallback. It is
mutually exclusive with flag-level rollout and never installs a timer or worker.

## Propagation

Emergency updates follow the existing validated snapshot replacement/watch path.
They affect evaluations starting after successful provider update; in-flight calls
retain their captured state. Polling/debounce and delivery delay still apply. There
is no maximum or instantaneous propagation promise from a single local measurement.
