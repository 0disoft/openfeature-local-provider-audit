# Local evaluation baseline

## Guarded membership component comparison: alpha.116

Local Windows x64 / Node v24.14.0, 2026-10-29 KST: one validated v2 boolean flag
with 20 ordered `not(in)` rules, each containing 99 distinct string candidates and
numeric zero last. Context tenant is numeric zero: all rules must reject and keep
the false default. Setup/parsing is outside timing; 5,000 warmup evaluations,
then five samples of 30,000 synchronous `evaluateFlag` calls, without I/O.

| Source | Five sample durations (ms) | Median (ms) |
| --- | --- | ---: |
| alpha.115 / `4e5a18c` | 4594.78, 4457.36, 4440.18, 4353.20, 4697.92 | 4457.36 |
| alpha.116 type index | 160.48, 168.42, 142.19, 141.36, 144.01 | 144.01 |

The median for this type-scan-heavy component fixture decreased by 96.8% (30.95x).
Each evaluation formerly checked 2,000 candidate types; it now does 20 type-set and
20 value-set lookups. All 150,000 measured evaluations in each run returned false.
The five scalar type/index boundary regressions include mutable/caller-frozen
inputs and 15/16/100-candidate parity. This is not a production throughput, general
workload speedup, p95, RSS, or cross-runtime performance claim. Homogeneous lists
whose type matches their first candidate did not incur that worst-case type scan.

## Current local sample: alpha.107

Measured 2026-10-27T19:48:12.734Z (2026-10-28 KST), source commit
`e579b214d09b30535ef8608e0d1e71052bb9e384`, local unpublished
`2.0.0-alpha.107`, Windows x64, Node v24.14.0. Command:
`corepack pnpm run benchmark:evaluation --iterations 1000 --output .git/current-evaluation-evidence.json`.
All 17 existing scenarios completed with 1,000 sequential calls each. Setup is
outside timing and existing result/rule/watcher assertions passed. The bounded
audit queue was sized to avoid saturation; no provider warnings occurred.
Machine-readable measurements and artifact/source provenance are retained in
[evaluation-performance-evidence-alpha107.json](evaluation-performance-evidence-alpha107.json).

| Case | p50 microseconds | p95 microseconds |
| --- | ---: | ---: |
| Static, 1,000 flags | 0.4 | 0.5 |
| Percentage, 1,000 flags | 5.8 | 7.8 |
| Targeting, 100 visited rules / 1,000 flags | 13.9 | 15.8 |
| SemVer, 100 rules / valid input | 20.8 | 42.6 |
| SemVer, 100 rules / invalid input | 48.9 | 84.2 |
| Provider, audit disabled | 1.9 | 3.7 |
| Provider, non-blocking plain file audit | 27.2 | 55.3 |
| Provider, blocking plain file audit | 987.3 | 1,173.0 |

Non-blocking audit returned with 1,000 pending writes / 425,000 pending payload
bytes, then drained in 29.2 ms. After flush both counts were zero, with no dropped
or rejected writes. Its observed heap delta was 13,545,176 bytes; this is not peak
memory. Blocking audit had no pending writes at return. These plain file-sink
measurements do not qualify chained fsync/batching, evidence export, audit durability
or remote delivery. One atomic file replacement propagated in 63.6 ms with 10 ms
debounce and 50 ms polling; this is not a maximum propagation-time guarantee.

This is one informational developer-machine sample, including clock/JIT/OS effects.
It is not an A/B comparison, throughput/SLO claim, CI performance gate or proof of
an improvement over historical samples. Historical case sets, iteration counts and
artifacts differ. Other OSs, physical hosts, runtime versions and production loads
remain unmeasured; portable-core conformance is a separate receipt and does not
establish these Node/provider timings on non-Node runtimes.

## Historical October 21 baseline

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
