# Contributing

Status: Draft
Owner: 0disoft

## Purpose

Contributions should keep this repository focused on a local OpenFeature provider package:
file/env flag loading, typed evaluation, deterministic bucketing, evaluation reasons,
redacted audit logs, and replay fixtures.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: local provider library and SDK examples; no hosted control plane.
- Data ownership: caller-owned flag files, caller-owned evaluation context, and local audit artifacts.
- Failure and recovery behavior: invalid config and evaluation errors must be explicit and replayable.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- The change turns the package into a hosted flag platform, dashboard, remote rollout service, or segment database.
- The change changes bucketing, reason names, audit event fields, or env override priority without compatibility notes.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
