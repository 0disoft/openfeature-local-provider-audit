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
Variant references must exist. Rollouts contain at most 100 entries in v2 and retain
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

## Selection and failure

After flag existence and requested type checks, `disabledVariant` immediately selects
that existing variant with reason `DISABLED`, bypassing overrides and targeting.
Removing it restores normal selection. V1 override behavior is unchanged.

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
