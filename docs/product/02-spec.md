# Product Specification

Status: Draft
Owner: 0disoft

## Purpose

This repository produces a local OpenFeature provider package. The provider resolves
feature flags from local configuration and environment overrides while preserving
OpenFeature's provider abstraction: applications keep calling the OpenFeature evaluation
API, and the underlying flag source can later be replaced by another provider.

## Source of Truth

- Product decision: local file/env provider with deterministic bucketing, evaluation reasons, audit log, and replay fixtures.
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md
- Scope cut: docs/product/04-scope-cut.md
- Library contracts: docs/library/flag-file-schema-v1.md, docs/library/env-overrides.md, docs/library/bucketing-v1.md, docs/library/evaluation-reasons.md, docs/library/audit-event-v1.md, docs/library/replay-fixture-v1.md
- Security contracts: docs/security/privacy-and-redaction.md, docs/security/threat-model.md

## MVP Scope

- JSON flag file support first. YAML may be added later through an explicit parser decision.
- Environment variable override layer with documented priority over file defaults.
- Boolean, string, number, and object flag values.
- Deterministic percentage bucketing from a stable targeting key and flag key.
- Evaluation reason output for default, static match, override, percentage bucket, and error paths.
- JSON Lines audit events with redacted targeting context and stable replay inputs.
- Snapshot/replay fixture format for tests and CI.
- Missing flag behavior that returns the caller's OpenFeature default value with reason metadata.

## Out of Scope

- Hosted feature flag SaaS UI.
- Remote management server or streaming updates.
- Approval workflow, experiment analytics, or segment database.
- All-language SDK support in the first version.
- Full replacement for flagd, LaunchDarkly, Flagsmith, or GO Feature Flag.
- YAML, file watch/reload, browser SDK, CLI, and general-purpose targeting rule language in the MVP.

## Required Decisions

- Boundary: local provider package plus SDK examples; no hosted control plane.
- Data ownership: flag files and audit logs remain caller-owned local artifacts.
- Failure and recovery behavior: parse and schema failures are explicit; runtime evaluation never silently pretends a malformed flag matched.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- Public API changes are made without compatibility and semver notes.
- Audit events include raw user identifiers, emails, or context fields by default.
- Bucketing behavior changes without replay fixture updates.
- Env override priority changes without migration notes.
- A deferred feature from docs/product/04-scope-cut.md enters the MVP without an ADR.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
