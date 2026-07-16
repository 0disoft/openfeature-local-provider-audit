# Risk Register

Status: Draft
Owner: 0disoft

## Purpose

This register tracks product risks that can make a local feature flag provider unsafe,
surprising, or too large to maintain.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Bucketing algorithm drift | Users move between rollout groups after upgrade. | Treat bucketing output as compatibility-sensitive and cover it with replay fixtures. |
| Env override ambiguity | Operators cannot explain why a flag resolved to a value. | Document source priority and include source/reason in evaluation metadata. |
| Audit log privacy leak | Targeting keys or context values expose user data. | Redact context by default and log reason summaries instead of raw context. |
| Dynamic context key disclosure | Applications encode emails or tokens in property names and the `names` mode records them. | Default to `count` from `0.14.0`; require an explicit `names` choice and document it only for fixed schema-like keys. |
| Audit backlog overflow | Sustained slow or failed storage can exhaust a queue or reject audit writes. | Default to 5,000 pending writes with reject observability, expose dropped/rejected counters, allow measured finite limits, and require explicit `null` for unbounded operation. |
| Projected-volume reload gap | Kubernetes-style internal symlink swaps do not emit the visible filename and can leave a stale snapshot. | Enable bounded consistency polling when needed; Linux fixtures cover internal symlink swaps, and native watching remains the primary signal. |
| Unsound evaluator request typing | `expectedType` can disagree with a generically inferred default type and produce a runtime value outside the inferred type. | Use a discriminated `EvaluationRequest` from `0.14.0` and keep negative compile fixtures for mismatched default values and expected types. |
| Silent snapshot typos | Unknown schema fields are discarded, so misspelled rollout or metadata fields appear valid. | Reject unknown snapshot, flag-definition, and rollout-rule fields from `0.14.0`; keep dynamic flag, variant, and metadata keys open. |
| Provider grows into a platform | Project competes with hosted flag products and loses its small-team value. | Keep dashboard, remote rollout, approval workflow, analytics, and segment storage out of MVP. |
| File reload/watch complexity | Runtime behavior becomes nondeterministic. | Keep evaluation file-I/O free, preserve the last valid snapshot on reload failure, and cover watch mode with event tests. |
| CLI scope creep | A helper command turns into flag management tooling. | Keep CLI helpers local, read-only, file-based, and covered by ADR review before adding commands. |

## Required Decisions

- Boundary: local library and SDK examples only.
- Data ownership: local flag files and audit artifacts remain caller-owned.
- Failure and recovery behavior: invalid config is explicit, defaults are reasoned, and replay fixtures prove recovery assumptions.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A risk-bearing behavior change lacks a fixture, migration note, or rollback path.
- A new audit field can contain unredacted user context.
- A platform feature enters scope without replacing or updating this risk register.
