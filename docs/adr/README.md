# Architecture Decisions

Status: Draft
Owner: 0disoft

## Purpose

Architecture decisions record why this package remains a local OpenFeature provider and
which behavior becomes part of the public compatibility contract.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: local provider package, SDK examples, audit/replay docs, and compatibility notes.
- Data ownership: caller-owned local configuration and audit artifacts.
- Failure and recovery behavior: reason taxonomy and replay fixtures must explain evaluated values.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A platform, dashboard, remote service, database, or experiment feature enters scope without an ADR.
- A public behavior change lacks semver and compatibility review.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
