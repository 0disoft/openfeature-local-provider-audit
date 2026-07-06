# Authorization

Status: Draft

## Backend Contract

The MVP owns no authorization model. Targeting context can influence flag evaluation,
but it must not be treated as permission enforcement.

## Required Decisions

- API owner: not applicable.
- Auth model: caller-owned.
- Authorization checks: caller-owned and outside provider scope.
- Persistence model: local flag files and local audit output only.
- Error response policy: evaluation reasons must not imply allow/deny decisions.

## Merge Blockers

- A flag rule is documented as an authorization control.
- A provider API accepts secrets or credentials to decide access.
- Audit or replay fixtures expose raw authorization context by default.
