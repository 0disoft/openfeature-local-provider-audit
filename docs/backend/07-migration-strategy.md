# Migration Strategy

Status: Draft

## Backend Contract

Migration strategy covers library compatibility, not database rollout. The riskiest
migrations are flag schema, env override naming, bucketing output, reason names, and
audit event shape.

## Required Decisions

- API owner: not applicable.
- Auth model: not applicable.
- Authorization checks: caller-owned.
- Persistence model: no DB migrations; local artifact format migrations only.
- Error response policy: migration notes must preserve error and reason semantics.

## Merge Blockers

- A compatibility-sensitive behavior changes without semver and migration notes.
- Replay fixtures are not updated for changed bucketing or reason behavior.
- A remote migration or database rollout is required for normal package upgrade.
