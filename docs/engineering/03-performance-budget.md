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
- Watch path: Linux uses one native directory watcher. macOS uses native directory and file
  watchers whose duplicate events are debounced and semantically unchanged snapshots are
  suppressed; the file watcher is replaced only after a target rename. Windows uses bounded file
  polling with a minimum 50 ms interval to avoid unstable native file-event behavior.
- Override path: explicit JSON override strings are size-checked before parsing.
- Package size: avoid dependencies that turn the provider into a platform or service runtime.

## Audit Queue Benchmark

Run `pnpm run benchmark:audit-queue` to compare a fast file sink with unbounded,
bounded-reject, and bounded-drop-newest queues under a deliberate advisory-lock stall.
The harness reports enqueue and drain time, peak pending writes, sampled heap growth,
written records, rejections, and drops. The stalled scenarios retain advisory locking
while draining, so their drain time includes per-write lock overhead and must not be read
as raw filesystem throughput. Optional `--writes`, `--queue-size`, `--stall-ms`, and
`--json` arguments change the sampled workload. `--output <path>` also writes the full
JSON report to a file without changing the console format; for example,
`pnpm run benchmark:audit-queue -- --writes 10000 --queue-size 1000 --json`.

The benchmark is intentionally not a CI gate. Filesystem speed, scheduler behavior, and
heap measurements vary by host. The manual `audit queue benchmark` GitHub Actions
workflow runs the same inputs on Ubuntu, Windows, and macOS and uploads one JSON result
per runner. It is sampling infrastructure, not a merge or release gate. Use repeated
measurements on deployment-like hardware
before choosing a default queue size, and treat every run as sampled evidence rather than
a portable throughput guarantee. A bounded default remains UNDECIDED until measurements
cover normal local disks and a sustained sink stall without unaccounted writes.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
