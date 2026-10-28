# ADR 0016: Offline condition reuse, without runtime segments

Status: Accepted for local alpha.113 implementation, 2026-10-28.

## Evidence and need

The inspected node-basic flags.json is v1 with two flags and no targeting rules;
core-basic uses inline programmatic configuration. No production configuration or
independent adoption evidence establishes demand for runtime segment storage. Do
not claim such evidence. The concrete authoring use case is changing one shared
tenant/version/exclusion predicate consistently across two or more v2 rules.
Inline-only conditions require editing each copy. This implements the requested
reuse investigation as a bounded authoring workflow; runtime references and a user
database are unnecessary.

## Decision

Add only an offline compile-segments CLI accepting an explicit authoringVersion:1
envelope with segments and snapshot. References are exact {segment:name} condition
nodes. Emit an ordinary validated v2 snapshot with all references expanded and no
segment registry. Runtime snapshots/APIs, signed payloads, provider reload and audit
formats are unchanged. Default output is a redacted report; full sensitive output
requires --emit-snapshot. No network, source writes or activation is performed.

At most64 named definitions, names1..128 nonblank UTF16 units; own-name resolution
only. All definitions, including unused ones, must be valid; unknown names and active
reference cycles reject. Each traversal, including reference hops, counts against
8 levels/100 nodes, so transparent aliases cannot bypass bounds. Separately validate
each definition (at most6400 visits), then limit all rule expansion to10000 visits;
reject before materializing the first excess node. Existing100 rules/flag and20
children/group limits apply. Existing byte/node budgets bound source capture and
the final runtime validator remains authoritative. No expansion memoization is used:
count each occurrence to prevent cached shared definitions bypassing work budgets.

## Compatibility and validation

Existing inputs/exports retain their shape. Expanded and manually inline snapshots
must have identical canonical hashes and evaluation/replay/explanation behavior,
including guarded negation invalidity. The output, not the authoring envelope, is
the artifact to validate/sign/deploy. Preserve old runtime receipts; no evaluation
performance benefit is claimed. Check cycle/missing/unused references, exponential
fanout, shared DAG reuse, exact limits, immutability/redaction, actual packed CLI and
root/core consumers. Do not introduce full foreign JsonLogic conversion without
separate equivalence evidence. Product boundary remains docs/product/04-scope-cut.md;
authoring contract is docs/library/reusable-conditions.md.
