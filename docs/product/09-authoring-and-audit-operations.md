# Authoring and audit operations follow-up

Owner: 0disoft. Authorized 2026-10-24 KST after review of local alpha.42.
Work on the existing main only, verify and commit each unit locally. No push,
publication, deployment, new branch/worktree, or independent adoption evidence.
Per run, keep the existing 20-minute limit and start no new unit after 10 minutes.
Preserve unrelated changes and resume unfinished work before selecting another unit.

## Ordered acceptance

1. Current-version guidance: completed. README and adoption guide link package
   metadata instead of duplicating a current version. Release readiness guards the
   link and rejects the old hard-coded introductions. Dated registry/runtime evidence
   keeps its original version and does not imply fresh verification.
2. CLI key compatibility: completed in alpha.43. Accept existing nonempty keys longer than 256
   characters without narrowing the parser; preserve file/node/depth/count limits.
3. Queue byte metrics: completed in alpha.44. Export pending bytes and finite capacity with byte
   units, no sensitive labels, shared-sink deduplication and lifecycle cleanup.
   Unknown/unbounded counts distinguish partial capacity; explicit zero replaces
   old observable values when the SDK retains unobserved series.
4. Inspection policy and diagnostics: completed in alpha.45. Opt-in comparison thresholds with
   explicit exit status; safe bounded error code/location without raw user input.
   Preserve default reports, privacy and evaluation-error precedence.
5. Authoring support: completed in alpha.46/.47. Offline versioned JSON Schema,
   structural conformance tests, explicit runtime-only semantic constraints, and
   standalone flag-key/value declaration generation with packed TypeScript consumer
   verification; see `../library/authoring.md`.
6. Audit outcome correlation: completed in local alpha.104. Opt-in provider metadata
   links candidate event IDs to at-return write outcomes and audit-default decisions;
   an isolated redacted observer reports the provider response. SDK after/finally
   hooks are a separate boundary. Candidate records and default privacy remain;
   no business execution claim or recursive error audit is made. See
   `../library/audit-failure-policy.md`.
7. Read-only chained audit diagnosis: completed in local alpha.105 through the
   bounded `audit-diagnose` CLI. It reports observed lock/manifest/segment issues
   without initializing, recovering or deleting evidence; active changes remain
   inconclusive. See `../library/audit-diagnosis.md`. Consistent evidence export is
   completed in local alpha.106: bounded exact local copies under the writer lock,
   then streamed verification, matched checkpoints and a completion inventory;
   caller-owned delivery follows lock release. See `../library/audit-evidence.md`.
   Snapshot-recovery journal inspection is completed separately in alpha.109 through
   bounded read-only `snapshot-diagnose`, with optional public verification settings;
   see `../library/snapshot-diagnosis.md`. It never activates or repairs storage.
8. Targeting and migration: deferred until the preceding units are complete and
   concrete required expressions/formats are selected. Extend bounded operators or
   references deliberately; preserve v1 behavior, bucketing, replay and cycle limits.
   Configuration conversion must report unsupported semantics rather than guess.

## Verification boundaries

Operational follow-up status on 2026-10-28 KST:

- Registry propagation policy completed in local alpha.107: bounded read-only
  reconciliation, per-attempt/overall deadlines and transient-only retries;
  candidate mismatches never retry or trigger another publish. See `../ops/release.md`.
- Latest full evidence remains alpha.107 (portable core unchanged through alpha.109):
  four-runtime packed-core conformance and a 17-scenario sequential Node evaluation/audit sample, both pinned
  to source/artifact identity. Historical receipts are preserved. See
  `../testing/core-runtime-acceptance.md` and `../testing/evaluation-performance.md`.
- Active signed snapshot expiry completed in local alpha.108: opt-in provider
  defaults at expiresAt, final audit-wait checks and observed-expiry latching;
  existing default/unsigned behavior remains. See `../library/active-snapshot-expiry.md`.
- Snapshot-recovery journal diagnosis completed in alpha.109, including structure-only
  and public-verification modes, observed-race handling and redacted issue indices.
- Next: select concrete targeting/migration semantics, preserve existing v1/replay
  boundaries and report unsupported conversions rather than infer equivalence.

Use narrow regression checks per unit, then the existing complete checks when runtime
or public behavior changes. No hosted CI run or independent-user evidence is needed.
Actual publication remains a separate explicitly authorized action. Native operating
systems and cloud accounts not exercised locally remain unverified.
