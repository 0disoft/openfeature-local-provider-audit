# Error Response

Status: Draft

## Backend Contract

Error behavior is a library contract, not an HTTP response contract. Failures should be
typed, explainable through evaluation reasons, and replayable when possible.

## Required Decisions

- API owner: not applicable.
- Auth model: not applicable.
- Authorization checks: caller-owned.
- Persistence model: local file/env inputs only.
- Error response policy: distinguish parse error, missing flag, type mismatch, override
  parse failure, bucketing fallback, and runtime provider-not-ready failures.

## Merge Blockers

- Errors silently return a non-default value after malformed configuration.
- Error names or reason names change without compatibility notes.
- Error output leaks raw targeting context, emails, tokens, or secrets.
