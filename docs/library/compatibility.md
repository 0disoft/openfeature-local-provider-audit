# Compatibility

Status: Draft
Repository Type: library

## Repository Type Contract

Compatibility means consumers can upgrade without unexplained flag resolution changes.
The most sensitive surfaces are bucketing, env override priority, reason names, audit
event schema, and flag file schema.

Detailed compatibility contracts live in:

- docs/library/flag-file-schema-v1.md
- docs/library/env-overrides.md
- docs/library/bucketing-v1.md
- docs/library/evaluation-reasons.md
- docs/library/audit-event-v1.md
- docs/library/replay-fixture-v1.md

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: package exports and documented provider behavior.
- Semantic versioning policy: behavior that can change evaluated flag values is compatibility-sensitive.
- Runtime and platform compatibility: server-side Node.js 22 LTS and Node.js 24 LTS are the MVP support targets; Bun, browser, Deno, and other runtimes are deferred.
- Package artifact and export surface: consumers must not rely on undocumented internal modules.
- Deprecation and migration policy: compatibility notes must include replay fixture expectations.
- Dependency compatibility: `@openfeature/server-sdk` remains a peer dependency.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Replay fixture drift is accepted without explaining the behavior change.
- Package metadata drifts from docs/adr/0004-package-license-runtime-policy.md.
