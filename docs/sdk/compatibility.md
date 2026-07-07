# SDK Compatibility

Status: Draft
Repository Type: sdk

## Repository Type Contract

SDK compatibility is measured by whether consumer examples continue to register the
provider, resolve sample flags, emit redacted audit events, and replay deterministic
fixtures across documented runtime targets.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- SDK ownership boundary: examples and compatibility notes, not hosted service operations.
- SDK public contract: examples must follow the documented provider API.
- SDK validation evidence: sample flag files and replay fixtures are required for compatibility claims.
- SDK release or rollout policy: publish examples with the same package version as the provider.
- SDK compatibility and migration policy: mark changed reason names, audit fields, schema, or bucketing behavior as migration-sensitive.

## Implemented Example

- `examples/node-basic` registers the provider through OpenFeature, resolves a local
  rollout flag, flushes the redacted audit sink, and verifies the same rollout path with
  `replayEvaluationFixture`.
- The example context uses synthetic non-personal fields and does not include emails,
  tokens, passwords, or real user identifiers.

## Review Blockers

- SDK examples drift from public API.
- Compatibility claims lack runtime or consumer evidence.
