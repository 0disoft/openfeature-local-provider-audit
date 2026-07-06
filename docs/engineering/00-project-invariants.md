# Project Invariants

Status: Draft

## Contract

Project invariants define what must remain true across implementation, tests, docs, configuration, and release behavior.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.

## Project-Specific Invariants

- The provider remains local-first and must not require a hosted service.
- Evaluation must be deterministic for the same flag snapshot, env override set, flag key, default value, and targeting key.
- Audit output is redacted by default and must not record raw evaluation context unless explicitly enabled.
- Bucketing behavior, reason names, flag schema, env override priority, and audit event fields are compatibility-sensitive.
