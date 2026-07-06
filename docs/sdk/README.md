# SDK

Status: Draft
Repository Type: sdk

## Repository Type Contract

The SDK surface owns consumer setup examples, provider registration examples, local flag
file examples, env override examples, audit output examples, and replay fixture examples.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- SDK ownership boundary: examples and helper APIs for integrating this provider with OpenFeature.
- SDK public contract: no example may rely on undocumented internal exports.
- SDK validation evidence: examples must be covered by docs or fixture checks once a runner exists.
- SDK release or rollout policy: publish only after provider behavior and replay fixtures are stable.
- SDK compatibility and migration policy: example changes must track public API and semver notes.

## Review Blockers

- SDK examples drift from public API.
- Compatibility claims lack runtime or consumer evidence.
