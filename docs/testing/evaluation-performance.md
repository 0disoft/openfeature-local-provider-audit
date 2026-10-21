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

## V2 development sample

Measured after f1026e3 on the same Windows/Node/pnpm combination, with the v2 benchmark
cases added alongside this update. Command:
`corepack pnpm run benchmark:evaluation --iterations 1000 --output .git/evaluation-v2.json`.
Captured at 2026-10-21T08:23:10Z. As above, this is one host-dependent sample, not a
speedup claim versus the earlier sample. Setup is outside timing; selected rule
identity is asserted. Both targeting cases contain 1,000 flags; the 100-rule case
matches the last rule. SemVer and conditional rollout are measured together.

| Case | p50 microseconds | p95 microseconds |
| --- | ---: | ---: |
| V1 static, 1,000 flags | 0.4 | 0.4 |
| V1 percentage, 1,000 flags | 5.6 | 7.1 |
| V2 attribute, 1 rule | 1.3 | 1.6 |
| V2 attribute, 100 visited rules | 8.9 | 14.8 |
| V2 tenant + SemVer + conditional percentage | 8.5 | 16.1 |
| Provider, audit disabled | 2.3 | 5.5 |
| Provider, non-blocking audit | 7.8 | 13.7 |
| Provider, blocking audit | 943.2 | 1,165.0 |

Non-blocking audit returned with 1,000 pending writes and drained in another 985.8 ms;
the observed heap delta was 4,948,560 bytes. No writes were dropped/rejected. One
atomic replacement propagated in 78.4 ms. These observations establish neither
maximum latency nor peak memory, and do not measure the maximum 100-node condition
tree for all 100 rules. Large rules need deployment-specific measurements.

The existing queue benchmark was also run with 100 writes, queue size 10 and a 50 ms
advisory-lock stall (`benchmark:audit-queue --writes 100 --queue-size 10 --stall-ms 50
--json --output .git/p1-audit-stall.json`). Fast/stalled unbounded cases wrote 100;
bounded reject wrote 10/rejected 90; bounded drop-newest wrote 10/dropped 90. All
cases accounted for every write with zero unexplained failures. This is a correctness
sample; the historical cross-platform decision evidence still owns the default size.
