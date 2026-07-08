# Performance Budget

Status: Draft

## Contract

Performance budgets must fit a local provider library. Evaluation should avoid network
calls, database reads, unbounded context serialization, and avoidable per-call file reads
unless an explicit reload mode is documented.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Budgets

- Evaluation path: constant work relative to the selected flag rule where practical and
  no per-evaluation file I/O.
- Audit path: redaction and JSON Lines writing must not expose raw context or block unrelated evaluations without documentation.
- File audit sink queueing is unbounded by default for compatibility; callers can set
  `maxQueueSize` and choose reject or drop-newest overflow behavior for high-pressure
  local writers.
- Provider audit path: snapshot and override hashes are computed when provider state is
  created or updated, not by re-hashing the full snapshot on every evaluation.
- Snapshot path: file parsing and validation occur at explicit load, reload, or watch
  boundaries. Snapshot files are size-checked before parsing, and failed reloads preserve
  the last valid snapshot.
- Override path: explicit JSON override strings are size-checked before parsing.
- Package size: avoid dependencies that turn the provider into a platform or service runtime.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
