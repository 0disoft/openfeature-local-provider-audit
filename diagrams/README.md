# Diagrams

Status: Draft
Owner: 0disoft

## Purpose

Diagrams should explain local provider evaluation, snapshot/replay behavior, audit event
flow, and the explicit absence of hosted control-plane dependencies.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: diagrams may show local files, env overrides, provider evaluation, audit logs, and replay fixtures.
- Data ownership: diagrams must show flag files and audit logs as caller-owned local artifacts.
- Failure and recovery behavior: diagrams should include parse error, missing flag, type mismatch, override, bucket, and default paths when relevant.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A diagram implies a hosted service, dashboard, database, or streaming control plane that is not in the spec.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
