# Operability and Failure Standard

Status: Draft

## Contract

Operability standard connects code changes to logs, metrics, traces, rollback, runbooks, health checks, incident response, and failure evidence.

## Required Evidence

- Source of truth: UNDECIDED
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
