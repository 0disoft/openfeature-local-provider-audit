# Code Review Checklist

Status: Draft

## Contract

Code review blockers include ownership drift, hidden auth or tenant rules, untested failure paths, contract drift, fake validation success, and generated-output dependency.

## Required Evidence

- Source of truth: UNDECIDED
- Owner: UNASSIGNED
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
