# HTTP API Policy

Status: Draft

## Backend Contract

There is no HTTP API in the MVP. `api/openapi.yaml` exists only to make that boundary
explicit until a future ADR adds a remote service.

## Required Decisions

- API owner: not applicable.
- Auth model: not applicable.
- Authorization checks: not applicable.
- Persistence model: no server-side persistence.
- Error response policy: library error objects, not HTTP responses.

## Merge Blockers

- A route, controller, RPC endpoint, or remote management API appears without ADR approval.
- Documentation implies network availability is required for flag evaluation.
- HTTP examples become the source of truth for public provider behavior.
