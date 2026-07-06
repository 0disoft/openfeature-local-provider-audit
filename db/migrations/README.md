# Migrations

Status: Draft
Owner: 0disoft

## Purpose

The MVP has no managed database migrations. This package reads caller-owned local flag
files and may write caller-owned local audit logs.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: no DB schema, no migrations, no hosted persistence.
- Data ownership: flag files and audit logs remain caller-owned local artifacts.
- Failure and recovery behavior: schema changes belong to flag-file compatibility and replay fixtures, not DB migrations.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A database table, migration, or remote persistence requirement appears without a new product decision and ADR.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
