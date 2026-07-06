# Seed Data

Status: Draft
Owner: 0disoft

## Purpose

The MVP has no database seed data. Example flag snapshots and replay fixtures should live
with library or SDK examples once implementation starts.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: no seed database records; only example local flag snapshots and replay fixtures.
- Data ownership: sample fixtures must not contain real identifiers, emails, tokens, or raw user context.
- Failure and recovery behavior: fixtures should include missing flag, malformed config, type mismatch, override, and bucketing examples when implementation exists.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- Seed data implies a database or hosted tenant model before an ADR.
- Example fixtures contain real personal data or secrets.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
