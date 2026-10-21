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

The CLI simulation and comparison interface is delivered in the next P1 slice; this
document does not claim a CLI command exists until that implementation is verified.
