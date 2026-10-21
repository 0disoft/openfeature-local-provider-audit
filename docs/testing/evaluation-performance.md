# Local evaluation baseline

Measured 2026-10-21 on Windows x64, Node.js 24.14.0, pnpm 12.14.0. Source base
4fa88d0 with the evaluation benchmark introduced alongside this report. Command:
`corepack pnpm run benchmark:evaluation --iterations 1000 --output .git/evaluation-baseline.json`.
This is one sequential synthetic sample on a developer machine, not a throughput
guarantee or cross-platform evidence. Latencies include timer overhead and are not
directly comparable to vendor benchmarks. Heap/RSS are observed deltas, not peaks.

| Case | p50 microseconds | p95 microseconds |
| --- | ---: | ---: |
| Static, 1 flag | 0.6 | 1.7 |
| Static, 1,000 flags | 0.7 | 0.9 |
| Percentage, 1 flag | 10.8 | 28.4 |
| Percentage, 1,000 flags | 8.4 | 13.0 |
| Provider, audit disabled | 2.2 | 3.8 |
| Provider, non-blocking file audit | 12.1 | 22.1 |
| Provider, blocking file audit | 1,473.7 | 2,268.0 |

The non-blocking case returned with 1,000 pending writes and took another 2,238 ms
to flush; the blocking case returned with no pending writes. Neither dropped nor
rejected records. The non-blocking heap delta was 4,962,384 bytes. Returning quickly
does not imply audit durability. Use the bounded queue and explicit shutdown flush.
One atomic replacement reached the reloadable provider in 83.5 ms with 10 ms debounce
and 50 ms consistency polling. This does not establish a maximum propagation delay.

The benchmark explicitly checks the changed value, fails on provider warnings, closes
its watcher and removes temporary files. Audit queue saturation is covered by the
separate `benchmark:audit-queue` harness. Linux/macOS results and v2 targeting cost
remain to be measured; do not extrapolate these numbers to other hosts or rule counts.
