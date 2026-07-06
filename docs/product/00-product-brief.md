# Product Brief

Status: Draft
Owner: 0disoft

## Purpose

OpenFeature Local Provider with Audit Log gives small teams, test suites, local
development environments, and air-gapped deployments a vendor-neutral feature flag
provider without requiring a SaaS flag platform.

The product is a library/SDK package, not a hosted service. It implements a local
OpenFeature provider backed by a checked-in flag file and controlled environment variable
overrides, then records evaluation reasons and redacted JSON Lines audit events so teams
can reproduce flag behavior later.

## Source of Truth

- Product decision: build a local file/env OpenFeature provider with deterministic audit evidence.
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: local provider library, SDK examples, audit/replay fixtures, and compatibility docs.
- Data ownership: caller-owned flag files, caller-provided evaluation context, and local audit log events.
- Failure and recovery behavior: invalid flag config fails closed with typed errors; missing flags return OpenFeature defaults with reason metadata.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- The change turns the library into a hosted flag control plane, dashboard, or remote rollout service.
- The change logs raw targeting keys or evaluation context values without redaction policy.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
