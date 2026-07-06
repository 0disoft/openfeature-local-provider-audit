# Development

Status: Draft
Owner: 0disoft

## Purpose

Development work should preserve the package boundary before adding implementation:
the provider must stay local, deterministic, explainable, and safe to audit without a
network service.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: provider package, public API docs, SDK examples, replay fixtures, and compatibility docs.
- Data ownership: local files and audit logs remain caller-owned.
- Failure and recovery behavior: parse failures, type mismatches, missing flags, override failures, and bucketing fallbacks must have explicit reasons.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- The change introduces network, database, or runtime service assumptions before an ADR.
- The change makes flag evaluation nondeterministic for the same snapshot and targeting key.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
