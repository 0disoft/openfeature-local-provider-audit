# Public API

Status: Draft
Repository Type: library

## Repository Type Contract

The public API must let consumers register a local provider, load flag snapshots,
override with environment variables, inspect evaluation reasons, emit redacted audit
events, and replay deterministic fixtures without depending on a hosted service.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: provider constructor, flag file loader, env override mapper, audit logger/redactor, replay helper.
- Semantic versioning policy: public exports, reason names, audit event fields, and bucketing output changes are breaking unless documented otherwise.
- Runtime and platform compatibility: TypeScript package first; supported runtimes must be proven before release.
- Package artifact and export surface: exports must match this document and examples.
- Deprecation and migration policy: provide migration notes for flag schema, override naming, and bucketing changes.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
