# Initial Architecture Boundaries

Status: Draft
Owner: 0disoft

## Purpose

Record the first architecture boundary for OpenFeature Local Provider with Audit Log:
the project is a local provider library and SDK surface, not a hosted feature flag
platform.

## Source of Truth

- Product decision: keep the MVP local-provider-first.
- Technical owner: 0disoft
- Related ADR: docs/adr/0002-contract-source-of-truth.md

## Required Decisions

- Boundary: provider package, local config loading, env overrides, deterministic bucketing, audit events, and replay fixtures.
- Data ownership: callers own flag files, evaluation context, and local audit artifacts.
- Failure and recovery behavior: malformed config fails explicitly; missing flags return OpenFeature defaults with reason metadata.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A change adds a hosted dashboard, remote service, approval workflow, or experiment platform without a new ADR.
- A change makes local evaluation depend on network availability.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
