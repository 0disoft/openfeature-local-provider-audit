# Library

Status: Draft
Repository Type: library

## Repository Type Contract

This library owns the OpenFeature provider package surface: provider construction,
flag snapshot loading, env override policy, deterministic bucketing, audit event
formatting, and replay fixture helpers.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: provider factory, config loaders, audit redactors, and replay helpers.
- Semantic versioning policy: public exports, reason names, schema shape, and bucketing output are semver-sensitive.
- Runtime and platform compatibility: TypeScript/JavaScript package first; runtime targets remain undecided until implementation.
- Package artifact and export surface: no source exports without public API documentation.
- Deprecation and migration policy: changed bucketing or audit schema requires migration notes and replay fixture updates.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
