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

## Required Coverage

- Boolean, string, number, and object evaluations.
- Missing flag default behavior with reason metadata.
- Invalid file, invalid schema, type mismatch, and env override parse failures.
- Deterministic percentage bucketing across replay fixtures.
- Audit redaction and JSON Lines event shape.
- SDK examples that use only documented exports.

## Coverage Gate

- `pnpm run test:coverage` measures all package files under `src/**/*.ts` except the thin
  `src/cli.ts` process bootstrap, whose installed behavior is covered by packed CLI smoke.
- Global minimums are 89% statements, 85% branches, 97% functions, and 89% lines.
- These thresholds are regression floors, not a reason to add assertion-free tests or exclude
  difficult modules. Raise them only after behavior-focused tests improve the measured baseline.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
