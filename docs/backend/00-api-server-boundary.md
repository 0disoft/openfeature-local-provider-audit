# API Server Boundary

Status: Draft

## Backend Contract

No API server is owned in the MVP. Backend scope means this package is expected to be
used by server-side applications, CLIs, tests, and local/offline environments.

## Required Decisions

- API owner: not applicable.
- Auth model: not applicable.
- Authorization checks: caller-owned.
- Persistence model: local flag file input and optional local audit log output.
- Error response policy: typed library errors and evaluation reasons.

## Merge Blockers

- HTTP or remote service behavior appears without an ADR.
- A local-only provider starts depending on network availability.
- Error behavior cannot be explained through public API docs.
