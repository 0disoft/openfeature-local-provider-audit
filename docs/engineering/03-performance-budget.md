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
- File audit sink queueing defaults to 5,000 pending writes with reject overflow
  behavior. Callers can select another positive limit, explicitly opt out with
  `maxQueueSize: null`, or choose drop-newest behavior for best-effort local writers.
- Provider audit path: snapshot and override hashes are computed when provider state is
  created or updated, not by re-hashing the full snapshot on every evaluation.
- Snapshot path: file parsing and validation occur at explicit load, reload, or watch
  boundaries. Snapshot files are size-checked before parsing, and failed reloads preserve
  the last valid snapshot.
- Watch path: Linux uses one native directory watcher. macOS uses native directory and file
  watchers whose duplicate events are debounced and semantically unchanged snapshots are
  suppressed; the file watcher is replaced only after a target rename. Windows uses bounded file
  polling with a minimum 50 ms interval to avoid unstable native file-event behavior.
- Projected-volume consistency polling remains proposed in ADR 0011. Any implementation must
  perform metadata-only idle ticks, reuse the serialized reload queue after fingerprint changes,
  and publish an interval budget backed by measurements before the option is accepted.
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
New reports use schema version 2 and identify their profile, sample, and repetition. The
summary tool continues to accept schema version 1 reports from earlier runs.

The benchmark is intentionally not a CI gate. Filesystem speed, scheduler behavior, and
heap measurements vary by host. The manual `audit queue benchmark` GitHub Actions
workflow offers fixed `quick` and `decision` profiles plus a single-run `custom` profile.
`quick` runs 5,000 writes with a queue of 1,000 and a 100 ms stall once per platform.
`decision` runs three repetitions per platform at 1 second with 5,000 writes, 5 seconds
with 10,000 writes, and 30 seconds with 25,000 writes; its dynamic matrix contains 27
benchmark jobs. A final job rejects missing platform repetitions, mismatched inputs,
unaccounted writes, invalid overflow behavior, or failed writes, then publishes raw runs,
median/minimum/maximum statistics, combined JSON, and a Markdown job summary. Timing and
heap values remain informational and never fail the run. It is sampling infrastructure,
not a merge or release gate. Use repeated measurements on deployment-like hardware
before choosing a default queue size, and treat every run as sampled evidence rather than
a portable throughput guarantee. ADR 0010 uses the completed cross-platform decision run
to select the bounded default while keeping timing values non-normative.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
