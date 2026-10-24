# Repeated immutable snapshot hash measurement

Measured 2026-10-25 KST on Windows x64, Node.js 24.14.0. Baseline: local main
`9eebaae`; after: the alpha.48 ownership-scoped snapshot hash memoization.
Reproduce with `pnpm benchmark:explanation` at either revision (the baseline uses
the same benchmark script added with this change). No network or file I/O occurs
in the timed sections. Parsing and preflight checks run outside timing.

The fixed workload selects one static boolean flag from a parsed snapshot, repeats
200 explanations, and reports the median of five warm samples. A separate cold
sequence counts root canonicalizations through Object.entries and compares each
explanation to the uncached caller-owned input. The patch is restored in finally.

| Flags | Source bytes | Before median ms | After median ms | Cold root walks before / after |
| --- | ---: | ---: | ---: | ---: |
| 1 | 114 | 2.4906 | 0.3187 | 200 / 1 |
| 1,000 | 86,919 | 574.9279 | 0.3424 | 200 / 1 |

For this 1,000-flag workload the warm repeated-call duration decreases by about
99.94%. This is a local microbenchmark, not a whole-server latency/throughput claim;
the provider already supplied its own cached hash. First use still canonicalizes
and hashes the full snapshot once. Request evaluation, rule tracing and override
hashes still run according to their original behavior.

Two baseline regression cases failed: metadata-free and metadata-bearing
validated snapshots each traversed the root five times instead of once. The
fixed test also checks mutable objects, shallow-frozen objects, frozen getters,
source mutation and distinct parsed identities. Caller-owned inputs intentionally
retain recalculation to avoid stale hashes. Only validator-owned copies qualify,
and weak references permit discarded snapshots to be collected.
