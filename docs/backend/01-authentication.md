# Authentication

Status: Draft

## Backend Contract

This backend document covers API server boundary, authentication, authorization, persistence model,
HTTP API policy, error response, logging and observability, migration strategy,
and backend security as applicable.

## Required Decisions

- API owner: UNASSIGNED
- Auth model: UNDECIDED
- Authorization checks: UNDECIDED
- Persistence model: UNDECIDED
- Error response policy: docs/backend/05-error-response.md

## Merge Blockers

- OpenAPI drift from api/openapi.yaml.
- Authorization behavior hidden in one handler or UI.
- Migration plan missing rollback or forward-fix path.
