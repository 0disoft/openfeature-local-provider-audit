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
6. Audit outcome correlation: pending. Opt-in event ID and confirmation outcome for
   the final SDK resolution; preserve candidate records and default privacy. Do not
   claim business execution or attempt to confirm an error through a failing sink.
7. Evidence export and read-only diagnosis: pending. Bounded consistent local copies
   paired with checkpoints, then caller-owned delivery after releasing writer locks.
   Diagnose locks/journals without stealing locks or deleting forensic evidence.
8. Targeting and migration: deferred until the preceding units are complete and
   concrete required expressions/formats are selected. Extend bounded operators or
   references deliberately; preserve v1 behavior, bucketing, replay and cycle limits.
   Configuration conversion must report unsupported semantics rather than guess.

## Verification boundaries

Use narrow regression checks per unit, then the existing complete checks when runtime
or public behavior changes. No hosted CI run or independent-user evidence is needed.
Actual publication remains a separate explicitly authorized action. Native operating
systems and cloud accounts not exercised locally remain unverified.
