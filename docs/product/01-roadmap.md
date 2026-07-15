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

## Completed Milestones

1. Define the flag file schema, env override naming, and evaluation reason taxonomy.
2. Implement provider contract tests for typed values, missing flags, invalid files, and defaults.
3. Add deterministic bucketing and replay fixtures that prove stable rollout assignment.
4. Add JSON Lines audit events with redaction defaults and snapshot/replay documentation.
5. Publish SDK examples that show OpenFeature registration and local test usage.
6. Use the accepted Apache-2.0, `@0disoft/openfeature-local-provider`, Node.js 22/24, and OpenFeature peer dependency policy for package skeleton work.
7. Publish `@0disoft/openfeature-local-provider` publicly through npm trusted publishing
   with provenance and GitHub Release artifacts.
8. Add JSON/YAML file loading, reloadable providers, and file watch helpers.
9. Add local snapshot validation CLI helpers.
10. Add context-key disclosure modes for stricter audit redaction without changing the
    existing default behavior.
11. Complete the `0.14` compatibility hardening: bind `EvaluationRequest` types, reject
    unknown snapshot fields, and default audit context disclosure to key counts.
12. Complete the `0.15` audit backpressure policy: validate repeated cross-platform
    overload evidence, default the file sink queue to 5,000, expose reject observability,
    and retain explicit unbounded migration behavior.

## Next Evaluation Areas

- Browser SDK.
- Additional language support after the TypeScript package surface proves useful.
- An optional projected-volume consistency strategy and OpenFeature configuration-change
  events. ADR 0011 now records the proposed bounded polling boundary and Linux fixtures
  reproduce the internal symlink swap. Completion still requires interval measurements,
  implementation, duplicate-event suppression, changed-key semantics, and shutdown tests.

## Deferred

- Hosted dashboard, remote service, streaming updates, approval workflow, experiment analytics, and user segment database.
- Multi-language SDKs until the TypeScript package surface proves useful.
- Package split until replay or test helpers have proven independent release value.

## Review Blockers

- A milestone adds platform behavior before the local provider contract is tested.
- A deferred item enters the MVP without an ADR.
- Validation needed before merge: VALIDATION.md
