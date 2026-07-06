# Design Review Questions

Status: Draft

## Contract

Design review must ask whether the change preserves the local-provider boundary,
deterministic evaluation, audit privacy, replayability, and OpenFeature compatibility.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Questions

- Does this require a hosted service, database, dashboard, or streaming control plane?
- Can the same snapshot, env, flag key, default, and targeting key reproduce the same value?
- Are reason names, audit fields, flag schema, env priority, or bucketing outputs changing?
- Does audit output redact context by default?
- Do examples use only documented public exports?

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
