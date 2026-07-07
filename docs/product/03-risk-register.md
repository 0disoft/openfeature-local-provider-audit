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
| Provider grows into a platform | Project competes with hosted flag products and loses its small-team value. | Keep dashboard, remote rollout, approval workflow, analytics, and segment storage out of MVP. |
| File reload/watch complexity | Runtime behavior becomes nondeterministic. | Keep evaluation file-I/O free, preserve the last valid snapshot on reload failure, and cover watch mode with event tests. |

## Required Decisions

- Boundary: local library and SDK examples only.
- Data ownership: local flag files and audit artifacts remain caller-owned.
- Failure and recovery behavior: invalid config is explicit, defaults are reasoned, and replay fixtures prove recovery assumptions.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A risk-bearing behavior change lacks a fixture, migration note, or rollback path.
- A new audit field can contain unredacted user context.
- A platform feature enters scope without replacing or updating this risk register.
