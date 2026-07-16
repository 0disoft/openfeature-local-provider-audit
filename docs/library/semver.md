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

## Compatibility-Sensitive Changes

- Changed evaluated flag value for the same snapshot, env override input, flag key, default value, and targeting key.
- Changed bucketing algorithm, hash input, seed behavior, bucket range, or percentage rounding.
- Changed env override priority or env naming contract.
- Changed reason names or error code mapping.
- Removed or retyped audit event fields.
- Changed redaction defaults.
- Changed file-audit queue defaults, overflow behavior, or counter meanings.
- Changed watcher polling defaults, interval validation, fingerprint meaning, or
  configuration-change event key semantics.
- Changed package exports or runtime support claims.
- Changed OpenFeature SDK dependency type from peer dependency to bundled dependency.
- Changed package name or license metadata.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
