# Operability and Failure Standard

Status: Draft

## Contract

Operability means a maintainer or caller can explain why a flag resolved to a value from
local evidence alone.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Failure Standard

- Parse errors identify the file/config boundary.
- Missing flags return caller defaults with reason metadata.
- Type mismatches do not silently coerce into surprising values.
- Env override failures name the override source without leaking raw sensitive values.
- Bucketing fallback and algorithm changes are replay-fixture visible.
- Audit write failures must not hide the evaluation reason.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
