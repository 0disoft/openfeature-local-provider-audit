# Semantic Versioning

Status: Draft
Repository Type: library

## Repository Type Contract

Semantic versioning protects consumers from silent changes to flag evaluation behavior.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: documented exports and evaluation behavior.
- Semantic versioning policy: breaking changes include renamed exports, changed flag file schema, changed env override priority, changed bucketing output, removed reason names, or audit event field removals.
- Runtime and platform compatibility: adding a runtime is minor; dropping or weakening a documented runtime is breaking.
- Package artifact and export surface: package exports must be included in compatibility review.
- Deprecation and migration policy: warn before removing old schema or reason names when feasible.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
