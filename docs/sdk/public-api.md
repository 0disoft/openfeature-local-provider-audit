# SDK Public API

Status: Draft
Repository Type: sdk

## Repository Type Contract

SDK-facing APIs should make the local provider easy to register, test, and replay while
keeping application code on the standard OpenFeature evaluation API.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

Scheduled schema-v2 flags evaluate against provider `clock` (default Date.now),
captured once per evaluation of a scheduled flag. SDK context cannot override this
clock. Pure requests/replay/CLI supply `evaluationTime` explicitly. No timer or
automatic refresh is installed. See `docs/library/scheduled-rollout.md` for priority,
audit metadata and backwards wall-clock behavior.

The unpublished P3 checkout adds optional `auditPseudonymizer` on both provider
factories and `pseudonymizer` on event creation. Construct it through
`createHmacAuditPseudonymizer` with a real caller-owned secret, nonpersonal keyId
and isolated scope. Output contains only the optional four-field pseudonym;
default events remain uncorrelated. See `docs/library/audit-pseudonyms.md`.

- SDK ownership boundary: provider setup examples, local config examples, audit examples, and replay fixture helpers.
- SDK public contract: examples must use documented exports only.
- SDK audit contract: examples may pass `auditSink` to `createLocalProvider`, but must not
  log raw evaluation context or evaluated object values.
- SDK audit lifecycle: short-lived examples may call `auditSink.flush?.()` before exit
  when using non-blocking audit writes.
- SDK audit file examples may configure `maxBytes` and `maxFiles` for local rotation.
- SDK audit file examples may configure `lock` for shared local audit files.
- SDK integration examples may combine strict context-key redaction, bounded audit
  queues, atomic file replacement, and reloadable providers, but must fail visibly when
  expected consumer behavior is missing.
- SDK integration examples may opt into projected-volume consistency polling and subscribe
  to OpenFeature configuration-change events with deterministic `flagsChanged` keys.
- SDK validation evidence: replay examples must prove deterministic bucketing when implementation exists.
- SDK release or rollout policy: example packages must not imply support for untested runtimes.
- SDK compatibility and migration policy: changed examples require matching public API and compatibility docs.
- The 2.0 development version accepts schema v2 conditions against the caller's merged
  OpenFeature context. `localProviderRuleId` identifies selected rules in details.
  `DISABLED` and `TARGETING_MATCH` are new reasons; raw context is never added to audit
  or explanation output. See `docs/library/flag-file-schema-v2.md` and
  `docs/library/local-inspection.md` for priority, replay, and CLI usage.

Provider factories also expose privacy-safe operational status in the 2.0
prerelease. Snapshot refresh status is separate from SDK lifecycle events;
see `docs/library/operational-status.md`.

Optional `metrics: createOpenTelemetryMetrics(meter)` uses a caller-owned Meter
without SDK/exporter installation or global registration. Labels exclude flag keys,
context and values; close unregisters status observation. See
`docs/library/opentelemetry-metrics.md`.

Caller-triggered HTTPS sources/refresher are optional, distinct from SDK
evaluation. The caller owns refreshing/shutdown and trusted URL/CA configuration.
See `docs/library/https-snapshots.md` for ETag commit, cancellation and last-good behavior.

Optional signed refresh authenticates audience/sequence/lifetime and snapshot
before provider application, including 304 freshness checks. Provider status and
each audit event capture exact artifact provenance atomically; unsigned updates
clear it. See `docs/library/signed-snapshots.md`. No signing key is needed
for evaluation or verification, and active last-good values are not disabled at expiry.

Standalone signed recovery returns an optional fresh current snapshot, authenticated
historical entries and a replay floor. Always seed signed refresh with the recovered
floor even when using safe bootstrap contents. See `docs/library/snapshot-recovery.md`;
optional `store` persists before atomic provider activation and keeps evaluations on
the previous state during I/O. Custom providers need the transaction capability.

The executable GitOps SDK composition lives in `examples/node-basic/src/gitops.ts`.
It signs validated local JSON/YAML, recovers a trusted journal with explicit
first-start authorization, composes signed durable HTTPS refresh and creates
higher-sequence rollback artifacts from authenticated history. These are example
helpers, not new package exports. `smoke:gitops` runs real loopback TLS/OpenFeature
checks without external upload or an added CI workflow. See
`docs/library/gitops-snapshots.md` for release and shutdown ownership.

Opt-in audit chain wrappers accept redacted AuditEvent v1 and an explicit starting
checkpoint; verification returns a checkpoint-only summary. Independent checkpoint
trust is caller-owned. No raw event fields are printed by `audit-verify`, and plain
file sinks remain unchanged. The opt-in chained file sink uses a dedicated directory
and mandatory shared lock, with bounded segments and verified checkpoint capture. See
`docs/library/audit-chain.md` for bounds and retained-prefix verification.

## Review Blockers

- SDK examples drift from public API.
- Compatibility claims lack runtime or consumer evidence.
