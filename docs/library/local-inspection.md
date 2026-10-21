# Local explanations and simulation

Source: ADR 0013. All inspection is local and read-only.

`explainEvaluation(snapshot, request)` uses the same evaluator as provider resolution.
It returns `EvaluationExplanation`: flag key, reason, source, snapshot hash, optional
override hash, selected variant/rule ID, optional bucket/error code, and ordered
`RuleExplanation` entries (`ruleId`, `matched`) for visited rules only. It never returns
evaluated values, context values/names, condition operands, flag metadata or raw errors.
Override/emergency/early error selection has no visited rules. Explanation hashes are
computed on demand; normal provider evaluation still uses cached hashes.

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

`evaluate` and `explain` are aliases for the same redacted explanation. Output is JSON
(optional `--json` is accepted). `--format auto|json|yaml` controls both snapshot files;
request files are always JSON. No stdin, network access, implicit process environment,
file writes, watcher or background service is involved. Files are limited to 10 MiB
each using the bounded loader. Request input is limited to 32 nesting levels and
100,000 JSON nodes; simulation/comparison accepts 1..10,000 requests within those limits.

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
An explicit targeting key wins over `context.targetingKey`; the latter is used if the
explicit field is omitted, as in the SDK path. Unknown request fields and mismatched
default types are rejected. Object defaults may be null.

Simulation returns total requests, snapshot hash, errors, and grouped counts by flag,
reason, variant, rule ID and error code. Comparison returns the same summaries for both
snapshots plus `changedValues` (structural JSON equality, ignoring object key order)
and `changedDecisions` (variant, rule, reason, source, error or bucket changed). Counts
may reveal small cohorts: use synthetic inputs or appropriately restricted reports.
No per-request rows, raw values or user context are returned. Group ordering follows
first encounter in the request file. Invalid input errors do not echo raw input.

Exit codes: 0 means all requested evaluations succeeded (differences do not cause
failure), 1 means input/load failure or at least one evaluation error, and 2 means
invalid CLI usage. Error evaluations still produce summaries; malformed input emits no
partial report. Existing `validate` behavior and exit codes remain unchanged.
