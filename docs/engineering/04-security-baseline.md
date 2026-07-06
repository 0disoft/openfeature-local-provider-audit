# Security Baseline

Status: Draft

## Contract

Security baseline focuses on keeping secrets and personal data out of examples, audit
logs, replay fixtures, generated output, and package metadata.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Baseline

- Redact evaluation context by default.
- Do not treat flag targeting as authorization.
- Do not require credentials for local evaluation.
- Do not ship examples with emails, tokens, passwords, or real user identifiers.
- Treat audit event shape and redaction controls as compatibility-sensitive.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
