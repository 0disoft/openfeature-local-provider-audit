# SDK Public API

Provider `snapshotExpiryPolicy: "returnDefault"` opts into active signed expiry,
returning the typed caller default with PROVIDER_NOT_READY at the provider decision
boundary. The default remains continue. Managed-provider options forward this
setting; unsigned bootstrap and SDK after/finally hooks retain their boundaries.
See `docs/library/active-snapshot-expiry.md`.

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

V2 startsWith/endsWith rules use bounded literal strings and the existing provider,
explanation, replay and audit paths; no raw comparison values enter diagnostics.
Older package versions reject these operators; deploy compatible evaluators first.

`snapshot-diagnose` is a separate read-only operator CLI, outside SDK resolution.
Structure-only, authenticated historical origin and fresh activation eligibility
are distinct observations; none activates a provider or proves the latest durable
floor. See `docs/library/snapshot-diagnosis.md`. No SDK API is added.

`exportChainedAuditEvidence` is an explicit Node operator action, separate from SDK
resolution and producer flushing. It captures retained committed files/checkpoints
under the writer lock, then validates the copy before publishing a completion marker.
Caller-owned delivery starts after success; it adds no uploader or background task.
See `docs/library/audit-evidence.md` for quotas, cancellation and checkpoint trust.

Optional provider `auditCorrelation` exposes the candidate event ID and audit
outcome in details metadata, including audit-default errors. `onAuditOutcome`
observes a frozen redacted provider response independently of metadata opt-in.
Provider responses precede SDK after/finally hooks and do not prove business
execution. See `docs/library/audit-failure-policy.md`.

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
  when using non-blocking audit writes. Provider `onClose` uses a separate
  `auditShutdownTimeoutMs` deadline (default 5,000 ms); timeout rejects without cancelling I/O.
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

`createS3SnapshotSource` composes with the same refresher using a caller-owned
AWS SDK v3 client for S3/R2. Credentials, HTTPS endpoint and client shutdown remain
caller concerns; no SDK runtime dependency is introduced. See
`docs/library/s3-snapshots.md` for attempt/byte limits and cancellation boundaries.

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

The additive package `/core` subpath exposes pure JSON/evaluation contracts without
provider registration or Node SDK types. Keep provider, file, audit and inspection
APIs on the existing Node root. See `docs/library/portable-core.md`; other runtime
support requires real execution evidence and is not established by this split.

Portable core runtime acceptance now covers only the exact local matrix in
`docs/library/compatibility.md`; see `docs/testing/core-runtime-acceptance.md`.
Node-root SDK contracts and supported provider runtimes stay unchanged.


The Node-root `createManagedLocalProvider` composes signed source verification,
file recovery and provider refresh with explicit polling and SDK-linked shutdown.
Its options default to no ambient env or context names. Source clients, signing,
registration and application intake remain caller-owned. See
`docs/library/managed-provider.md`; the GitOps consumer uses this public API.


Local unsigned file integrations can use `createWatchedLocalProvider` instead of
manually loading a file, constructing a provider and forwarding watcher callbacks.
The factory starts monitoring explicitly, provides reload/status and shares SDK
shutdown with its watcher cleanup. Existing low-level APIs keep their behavior.
See `docs/library/watched-provider.md` and the executable node-basic example.

Alpha.111 adds the Node `import-flagd` CLI for the explicitly supported static JSON
subset, with a redacted default report and opt-in complete sensitive output.
Unsupported semantics reject the whole conversion; no root/core API exports or
source files change. See `../library/import-flagd.md`.
