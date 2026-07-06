---
name: ops-change
description: Use this when working on ops-change changes in this repository scaffold.
---

# ops-change

## Read First

- AGENTS.md
- VALIDATION.md
- CHECKLIST.md
- .agents/context-map.md

## Procedure

1. Identify the source of truth.
2. Read the matching checklist.
3. Make the smallest change that preserves ownership boundaries.
4. Validate with the stable validation names from VALIDATION.md.

## Never

- Do not invent product-specific technology choices.
- Do not generate fake credentials or secrets.
- Do not treat generated/cache/build output as source truth.

## Checklist

- Source of truth confirmed.
- Failure mode checklist reviewed.
- Validation plan stated.

## Validation

Use stable validation names only. If a runner command is unconfigured, report it as skipped with reason.

## Final Report

List files changed, validations run, validations skipped, skip reasons, and remaining risk.
