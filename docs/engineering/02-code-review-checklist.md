# Code Review Checklist

Status: Draft

## Contract

Code review must treat flag resolution behavior as user-visible product behavior.
Small implementation changes can be breaking if they alter values, reasons, redaction,
or replay output.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Checklist

- Public exports match docs/library/public-api.md and docs/sdk/public-api.md.
- Bucketing behavior is covered by deterministic replay evidence.
- Error paths distinguish parse error, missing flag, type mismatch, override parse failure, and fallback.
- Audit output is redacted by default.
- No server, database, credential, or hosted control-plane assumption is introduced.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
