# Compatibility

Status: Draft
Repository Type: library

## Repository Type Contract

Compatibility means consumers can upgrade without unexplained flag resolution changes.
The most sensitive surfaces are bucketing, env override priority, reason names, audit
event schema, and flag file schema.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: package exports and documented provider behavior.
- Semantic versioning policy: behavior that can change evaluated flag values is compatibility-sensitive.
- Runtime and platform compatibility: Node/Bun/browser support remains undecided until tests exist.
- Package artifact and export surface: consumers must not rely on undocumented internal modules.
- Deprecation and migration policy: compatibility notes must include replay fixture expectations.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
