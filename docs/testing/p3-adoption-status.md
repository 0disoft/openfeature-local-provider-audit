# P3 adoption and performance evidence

Status: P3 local acceptance complete; independent adoption evidence/recording excluded
by the owner's 2026-10-22 KST decision. External adoption remains unverified.

The core-basic example is a private maintainer-owned consumer, not an external
adopter. The existing stable consumer report in
[cross-repository-consumer-evidence.json](cross-repository-consumer-evidence.json)
explicitly says same-maintainer and refers to an old published candidate, not P3.
The separate existing service-catalog and MCP Security Proxy integrations retain
their original disclosed scope in [registry evidence](registry-consumer-evidence.md).
No local preview, package download, benchmark or runtime fixture changes that scope.

On 2026-10-22 KST, read-only connected GitHub searches inspected the package string
in indexed default-branch code (24 returned paths, all under 0disoft), five open
repository issues (#10..#14) and four open PRs (#16..#19). These bounded/indexed
results supplied no independently owned, consented runtime-use report. They do
not prove no public/private external users exist. No GitHub issue/PR/comment,
remote branch or message was changed. Registry dist-tags remained latest=1.0.0,
next=1.0.0-rc.2; local alpha.18 was not published.

| P3 adoption prerequisite | Evidence / status |
| --- | --- |
| Usable current API example | examples/core-basic/index.mjs; local preview and real tarball consumer contract |
| Operational/security composition | Existing executable node-basic signed GitOps recipe; S3/HMAC/chain contracts |
| Runtime compatibility | core-runtime-acceptance.md and real four-runtime receipt, scoped to Windows x64 core |
| Reproducible performance | This local Node run and p3-performance-evidence.json |
| Actual independent use and owner consent | Excluded from P3 acceptance by owner decision; not verified or claimed |

## Measured Node performance

Captured 2026-10-21T16:17:07.952Z; Node v24.14.0 / win32-x64;
2,000 iterations per case, existing evaluation-benchmark script. Library version
alpha.18, source commit 69c1651; adoption example, runner and documentation changes
were uncommitted, while library runtime sources matched that commit during the
measurement. This is the workspace-built Node root, not an installed registry
artifact or a portable-runtime benchmark. All benchmark correctness, audit queue
and replacement propagation checks passed. Full raw output is
[p3-performance-evidence.json](p3-performance-evidence.json).

| Case | p50 microseconds | p95 microseconds |
| --- | ---: | ---: |
| pure-static-1-flags | 0.50 | 0.80 |
| pure-rollout-1-flags | 4.90 | 10.70 |
| pure-static-1000-flags | 0.60 | 0.90 |
| pure-rollout-1000-flags | 5.60 | 10.00 |
| pure-targeting-1-rules-1000-flags | 1.10 | 2.40 |
| pure-targeting-100-rules-1000-flags | 8.80 | 17.30 |
| pure-targeting-semver-conditional-rollout | 8.20 | 12.80 |
| provider-audit-off | 1.60 | 3.10 |
| provider-audit-nonBlocking | 9.40 | 14.00 |
| provider-audit-blocking | 959.20 | 1115.10 |

These are one informational run on one host, not an SLO or a regression comparison.
Per-call wall times include harness overhead and JIT/GC effects; warmup differs
across scenarios. Heap/RSS deltas are end-minus-start values, not peaks, allocation
counts or leak evidence. A blocking file sink includes local storage delay and
is not an fsync guarantee. Nonblocking measurements exclude deferred completion;
its queue is deliberately sized to avoid saturation. Use the separate audit-queue
benchmark for stalls. Production storage/network/scheduling and other hosts can
change the results. Reproduce commands are in the [adoption guide](../sdk/adoption-guide.md).

The owner excluded actual independent-adoption evidence and recording from P3 on
2026-10-22 KST. The completed examples and reproducible evidence satisfy the amended
material requirement; they do not establish external adoption. See the
[P3 completion audit](../product/08-privacy-and-portability.md) for all five accepted
requirements and their implementation/validation evidence. No evidence collection,
outreach, publication or deployment is part of this task. Existing v1 release gates
retain their original scope.
