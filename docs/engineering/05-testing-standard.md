# Testing Standard

Status: Draft

## Contract

Tests should prove values, reasons, redaction, and replay behavior rather than only
checking happy-path provider registration.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Required Coverage Once Implementation Exists

- Boolean, string, number, and object evaluations.
- Missing flag default behavior with reason metadata.
- Invalid file, invalid schema, type mismatch, and env override parse failures.
- Deterministic percentage bucketing across replay fixtures.
- Audit redaction and JSON Lines event shape.
- SDK examples that use only documented exports.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
