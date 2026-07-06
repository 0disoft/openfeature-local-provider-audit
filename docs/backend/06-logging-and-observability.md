# Logging and Observability

Status: Draft

## Backend Contract

Observability is local audit evidence: evaluation reason, source, flag key, variant,
redacted context summary, and replay-safe inputs.

## Required Decisions

- API owner: not applicable.
- Auth model: not applicable.
- Authorization checks: caller-owned.
- Persistence model: optional JSON Lines audit output.
- Error response policy: errors must be visible as reasons and audit event fields.

## Merge Blockers

- Audit output includes raw evaluation context by default.
- A resolution path cannot be explained from reason metadata.
- Replay evidence cannot reproduce deterministic bucket decisions.
