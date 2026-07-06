# SDK Public API

Status: Draft
Repository Type: sdk

## Repository Type Contract

SDK-facing APIs should make the local provider easy to register, test, and replay while
keeping application code on the standard OpenFeature evaluation API.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- SDK ownership boundary: provider setup examples, local config examples, audit examples, and replay fixture helpers.
- SDK public contract: examples must use documented exports only.
- SDK validation evidence: replay examples must prove deterministic bucketing when implementation exists.
- SDK release or rollout policy: example packages must not imply support for untested runtimes.
- SDK compatibility and migration policy: changed examples require matching public API and compatibility docs.

## Review Blockers

- SDK examples drift from public API.
- Compatibility claims lack runtime or consumer evidence.
