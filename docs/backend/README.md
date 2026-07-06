# Backend

Status: Draft

## Backend Contract

This repository uses the backend scope because the provider runs in server-side and
tooling contexts. It does not own an API server, user authentication system, database,
or migration workflow in the MVP.

## Required Decisions

- API owner: not applicable until a remote service is explicitly added.
- Auth model: not applicable for the local provider MVP.
- Authorization checks: caller-owned; this package only evaluates local flags.
- Persistence model: caller-owned local flag files and local audit logs.
- Error response policy: library errors should be typed and documented, not HTTP responses.

## Merge Blockers

- A change introduces a service endpoint without a new product decision and ADR.
- A change stores user context or audit logs remotely.
- Library error behavior drifts from docs/library/public-api.md.
