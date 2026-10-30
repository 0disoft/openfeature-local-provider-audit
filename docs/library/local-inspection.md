# Local explanations and simulation

Source: ADR 0013. All inspection is local and read-only.

ADR 0015 scheduled flags additionally use per-request `evaluationTime` (nonnegative
safe-integer epoch milliseconds). No implicit current time is read. Explanations
include optional `schedule: { evaluatedAt, stage, percentage }`; simulation accepts
different explicit times per row and comparison includes schedule metadata in
changedDecisions. See `scheduled-rollout.md` for stages and clock rollback.

`explainEvaluation(snapshot, request)` uses the same evaluator as provider resolution.
It returns `EvaluationExplanation`: flag key, reason, source, snapshot hash, optional
override hash, selected variant/rule ID, optional bucket/error code, and ordered
`RuleExplanation` entries (`ruleId`, `matched`) for visited rules only. It never returns
evaluated values, context values/names, condition operands, flag metadata or raw errors.
Override/emergency/early error selection has no visited rules. Snapshot hashes are
computed on first demand and reused only for validator-owned, deeply frozen copies.
Mutable or caller-frozen snapshots are recomputed; override hashes remain on demand.
Normal provider evaluation already supplies cached hashes. See `audit-event-v1.md`.

IDs, flag/variant names, rule match outcomes and hashes are still potentially sensitive
metadata. Define non-sensitive identifiers and restrict access to explanations. A
hash does not encrypt low-entropy input. Explanations intentionally omit enough input
that they cannot by themselves replay an evaluation. Preserve sanitized replay
fixtures and the matching configuration under an appropriate retention policy.

Audit v1 events and replay v1 expected results add optional `ruleId` for v2 selections.
Existing v1 outputs omit it. Replay compares rule identity as well as value, variant,
reason/source/error and bucket, so a changed rule cannot hide behind the same value.
Redaction does not invoke context getters; inherited targeting keys are not treated
as caller data. Changes to exhaustive public types require the 2.0 migration.

## CLI

After building/installing this version:

```sh
openfeature-local-provider evaluate flags.json --request request.json
openfeature-local-provider explain flags.json --request request.json
openfeature-local-provider simulate flags.json --requests requests.json
openfeature-local-provider compare before.json after.json --requests requests.json
```

`evaluate` and `explain` are aliases for the same redacted explanation. Output defaults
to JSON (optional `--json` is accepted). Compare additionally supports Markdown review
output as described below. `--format auto|json|yaml` controls both snapshot files;
request files are always JSON. No stdin, network access, implicit process environment,
file writes, watcher or background service is involved. Files are limited to 10 MiB
each using the bounded loader. Request input is limited to 32 nesting levels and
100,000 JSON nodes; simulation/comparison accepts 1..10,000 requests within those limits.

Array lengths are checked against the remaining node budget before copying child
values for traversal. The budget includes the root, containers, primitive values
and pending siblings. This avoids a child-value array allocation for an array
already certain to exceed the limit; JSON parsing still incurs its input-size cost.

Flag keys follow the snapshot parser's nonempty-string contract; there is no
separate 256-character inspection limit. Long keys remain covered by the request
file byte/node/depth limits above. Evaluation and inspection accept the same keys.

An evaluation input is:

```json
{
  "flagKey": "checkout.enabled",
  "expectedType": "boolean",
  "defaultValue": false,
  "targetingKey": "synthetic-subject",
  "context": { "tenant": "pilot", "appVersion": "2.1.0" }
}
```

Simulation/comparison request files contain an array of these objects. Optionally add
`overrides: { overridesJson: "...", env: { EXPLICIT_FLAG: "true" } }`; only the provided
environment is used and override mapping is recomputed for each compared snapshot.
An inspection-local, lazy envVar-to-flags index avoids scanning the full snapshot
for every request. Shared environment names still affect every referring flag in
snapshot order, and JSON overrides still take precedence over per-flag errors.
Before/after indexes are independent; request values/results are never cached and
the index is discarded with the inspection. No index is built for requests without
overrides. Existing validation, generic errors and first-encounter group order remain.
Batch requests are parsed and evaluated one at a time. Only their decisions are
retained, so completed requests do not keep unrelated override entries alive.
For R requests with F matching environment bindings, live override-state storage
is O(F), rather than O(R*F); input storage and retained decision values are additional.
The same R*F binding work still occurs. Malformed later requests emit no partial report.
An explicit targeting key wins over `context.targetingKey`; the latter is used if the
explicit field is omitted, as in the SDK path. Unknown request fields and mismatched
default types are rejected. Object defaults may be null.

Simulation returns total requests, snapshot hash, errors, and grouped counts by flag,
reason, variant, rule ID and error code. Comparison returns the same summaries for both
snapshots plus `changedValues` (structural JSON equality, ignoring object key order)
and `changedDecisions` (variant, rule, reason, source, error, bucket or schedule changed). Counts
may reveal small cohorts: use synthetic inputs or appropriately restricted reports.
No per-request rows, raw values or user context are returned. Group ordering follows
first encounter in the request file. Invalid input errors do not echo raw input.

Exit codes: 0 means all requested evaluations succeeded (differences do not cause
failure), 1 means input/load failure or at least one evaluation error, and 2 means
invalid CLI usage. Error evaluations still produce summaries; malformed input emits no
partial report. Existing `validate` behavior and exit codes remain unchanged.

## Human-readable review report (2.1)

```sh
openfeature-local-provider compare before.json after.json --requests synthetic-requests.json --output markdown
```

The opt-in report shows snapshot validation, complete aggregate counts, content hashes,
change-policy status, per-sampled-flag changes, and before/after reason, variant and
selected rule counts. No extra evaluation or network call is performed. JSON output
and all exit codes remain unchanged, including error precedence over policy rejection.
`--output json` is explicit JSON; mixing `--json` with a non-JSON `--output`, duplicate
`--output`, unsupported formats, and using `--output` on other commands exit 2.
`--format` still selects snapshot input parsing and is independent of presentation.

Reports describe the supplied corpus only. They are not a structural configuration diff,
a list of every affected condition, or an estimate of production impact. Removed sampled
flags appear as evaluation errors. Conditions not exercised by a request are not evaluated.
The report deliberately excludes context, subject IDs, condition operands, evaluated
values, raw configuration and paths. Flag/variant/rule identifiers and small-cohort counts
can still be sensitive; use synthetic fixtures and restrict report access.

Each table shows at most 100 rows in first-encounter order, with explicit omitted-row
counts; aggregate totals still include every request. Identifier display is limited to
160 UTF-16 code units per cell with an ellipsis, so long or similar truncated names need
the full JSON report for identification. The renderer escapes Markdown/HTML, mentions,
table delimiters and control/bidirectional characters in every displayed identifier.
Malformed later input emits no partial report. No file is written by the command;
redirect stdout to a report file or CI step summary in caller-owned tooling.

## Static visualization (2.2)

```sh
openfeature-local-provider compare before.json after.json --requests synthetic-requests.json --output html > review.html
```

Open `review.html` locally. It is one self-contained, read-only document: summary
cards, accessible per-flag change meters, expandable before/after tables, policy
status and snapshot hashes. Responsive and print styles are included. It uses the
same comparison, complete aggregate totals, redaction and exit-code precedence as
JSON/Markdown; no additional evaluations occur. `--json` conflicts with HTML just
as it conflicts with Markdown. Labels and tables have the same 160/100 display bounds.
The displayed percentages are rounded to one decimal for readability; policy
enforcement still uses the exact scaled-integer comparison described below.

No scripts, embedded request data, external styles/fonts/images, telemetry, file
picker, server or live audit/configuration connection is included. A restrictive
Content-Security-Policy permits only the document's inline styles. Identifiers are
escaped text, never markup, URL targets or executable attributes. Hashes and names
remain potentially sensitive and the exported file needs normal access/retention
controls. The view does not display condition operands or claim production impact.
Native details sections provide keyboard navigation without JavaScript.

This opt-in CLI presentation follows ADR0017. The browser smoke is
`corepack pnpm run smoke:review-html`; see `VALIDATION.md` for browser prerequisites.
It has no browser dependency in the published runtime package and adds no hosted CI.

For repeated object-valued decisions, comparison remembers structural equality per
before/after object pair within that single synchronous comparison. Only booleans
are retained through weak keys, not serialized payload strings. Every request is
still evaluated separately; different overrides, values and object pairs remain
independent. The cache is discarded when comparison returns. Object key order is
ignored and array order remains significant; reports, counts and exit codes do not
change. This does not change SDK evaluation or add a process-wide cache.

## Optional change policy and safe diagnostics

Compare accepts `--max-changed-values-percent <percent>` and
`--max-changed-decisions-percent <percent>`. Each is optional, may appear once,
and accepts an unsigned decimal in 0..100 with at most four decimal places.
These flags reject on other inspection commands. No threshold is implicit.

The denominator is every supplied request, including error evaluations; errors
always exit1 even if the policy also fails. Each limit is inclusive: 50% allows
exactly one changed value in two requests. Comparisons use scaled integer cross
multiplication, without rounding the observed rate. Limits are independently
checked against changedValues and changedDecisions. With any limit, the JSON
report adds `policy: { passed, maxChangedValuesPercent?,
maxChangedDecisionsPercent?, violations }`. Violations contain only bounded codes
`CHANGED_VALUES_LIMIT` and `CHANGED_DECISIONS_LIMIT`. Failed policy exits3 only
when evaluations succeeded. No flags preserves the existing output and exit codes.
This checks the supplied corpus, not an estimate of production traffic percentages.

`--diagnostics` opts into a second JSON stderr line after the existing generic
failure text: `{ "error": { "code": "REQUEST_SCHEMA", "requestIndex": 1 } }`.
The zero-based request index appears only for a malformed request in a list.
Other bounded categories are SNAPSHOT_INPUT, REQUEST_INPUT (read/JSON),
REQUEST_LIMIT (file-level JSON/request count bounds), and INSPECTION_FAILED.
Single malformed requests omit the index. No raw exception, file path, flag key,
attribute name, value or input fragment is included. Successful inspection emits
no diagnostic. Usage errors retain the existing usage response and exit2.
