# Roadmap

Status: Draft
Owner: 0disoft

## Purpose

This roadmap keeps the project small enough to be a reliable provider package rather than
a feature flag platform.

## Source of Truth

- Product decision: local provider first; remote control-plane work is out of scope.
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Milestones

1. Define the flag file schema, env override naming, and evaluation reason taxonomy.
2. Implement provider contract tests for typed values, missing flags, invalid files, and defaults.
3. Add deterministic bucketing and replay fixtures that prove stable rollout assignment.
4. Add JSON Lines audit events with redaction defaults and snapshot/replay documentation.
5. Publish SDK examples that show OpenFeature registration and local test usage.
6. Evaluate YAML support, file reload/watch behavior, and additional language support only after the core provider is stable.

## Deferred

- Hosted dashboard, remote service, streaming updates, approval workflow, experiment analytics, and user segment database.
- Runtime file watching until startup-load semantics and event behavior are tested.
- Multi-language SDKs until the TypeScript package surface proves useful.

## Review Blockers

- A milestone adds platform behavior before the local provider contract is tested.
- A deferred item enters the MVP without an ADR.
- Validation needed before merge: VALIDATION.md
