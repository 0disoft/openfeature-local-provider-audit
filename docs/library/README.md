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
- Flag schema: docs/library/flag-file-schema-v1.md
- Env overrides: docs/library/env-overrides.md
- Bucketing: docs/library/bucketing-v1.md
- Evaluation reasons: docs/library/evaluation-reasons.md
- Audit events: docs/library/audit-event-v1.md
- Replay fixtures: docs/library/replay-fixture-v1.md
- Configuration-change events: docs/library/configuration-change-events.md

## Required Decisions

- Public API ownership: provider factory, config loaders, audit redactors, and replay helpers.
- Semantic versioning policy: public exports, reason names, schema shape, and bucketing output are semver-sensitive.
- Runtime and platform compatibility: server-side Node.js 22 LTS and Node.js 24 LTS first.
- Package artifact and export surface: no source exports without public API documentation.
- Deprecation and migration policy: changed bucketing or audit schema requires migration notes and replay fixture updates.
- Dependency policy: `@openfeature/server-sdk` is a peer dependency.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Implementation drifts from docs/adr/0004-package-license-runtime-policy.md.
