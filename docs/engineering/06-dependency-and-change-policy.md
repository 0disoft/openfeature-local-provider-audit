# Dependency and Change Policy

Status: Draft

## Contract

Dependencies should preserve a small local-provider package. Adding parsers, hash
libraries, OpenFeature bindings, or filesystem helpers is a compatibility and supply-chain
decision, not filler.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Policy

- Runtime dependencies need a clear role in provider evaluation, file parsing, redaction, or replay.
- Hashing and bucketing dependencies are compatibility-sensitive.
- YAML, file watch, browser, Bun, Node, or other runtime support must be proven before being documented as supported.
- Dependencies must not introduce a hosted-service assumption.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
