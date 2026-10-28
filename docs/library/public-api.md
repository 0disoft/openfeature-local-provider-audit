# Public API

Optional `LocalProviderOptions.snapshotExpiryPolicy` (`SnapshotExpiryPolicy`) adds
Node-provider active signed expiry. Default `continue` preserves last-good behavior;
`returnDefault` gates captured signed artifacts at expiry and after audit waiting.
No portable-core API or per-evaluation signature check is added. See
`active-snapshot-expiry.md` for clock, update, audit and unsigned boundaries.

Status: Draft
Repository Type: library

## Repository Type Contract

The public API must let consumers register a local provider, load flag snapshots,
override with environment variables, inspect evaluation reasons, emit redacted audit
events, and replay deterministic fixtures without depending on a hosted service.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: provider constructor, flag file loader, env override mapper, audit logger/redactor, replay helper.
- Semantic versioning policy: public exports, reason names, audit event fields, and bucketing output changes are breaking unless documented otherwise.
- Runtime and platform compatibility: TypeScript package for server-side Node.js 22 LTS and Node.js 24 LTS first.
- Package artifact and export surface: exports must match this document and examples.
- Deprecation and migration policy: provide migration notes for flag schema, override naming, and bucketing changes.
- Dependency policy: provider code integrates with `@openfeature/server-sdk` through a peer dependency.
- Package CLI policy: command helpers must stay local, read-only, and file-based unless
  a later ADR changes the package boundary.

## Package Identity

- Primary package name: `@0disoft/openfeature-local-provider`.
- License: Apache-2.0.
- Package name does not include `audit`; audit remains a built-in capability.
- Package binary: `openfeature-local-provider`.

## Public Export Contract

- Provider creation API.
- JSON flag snapshot parser.
- YAML flag snapshot parser.
- JSON/YAML flag snapshot file loader.
- Reloadable local provider.
- Flag snapshot file watcher.
- Pure flag evaluator.
- Explicit environment override mapper.
- Local provider options.
- Flag snapshot and flag definition types.
- Evaluation request, result, env override state, reason, source, and error code types.
- Audit event and replay fixture types.

Implementation must not expose internal modules only because examples need convenience imports.

## Implemented Export Surface

TargetingCondition expands with v2 literal startsWith/endsWith in root and core
types, evaluation, explanations and replay. No runtime export is added. Existing
snapshots/hashes stay unchanged; see schema v2 and the 2.0 migration guide.

Read-only `snapshot-diagnose <journal>` reports bounded recovery-journal structure
and optional public-key authentication/activation policy observations. It adds no
root/core exports and never mutates storage or promotes history. See `snapshot-diagnosis.md`.

`exportChainedAuditEvidence`, `ExportAuditEvidenceOptions`, `AuditEvidenceFile` and
`AuditEvidenceExport` add bounded consistent local copies of retained chained
audit evidence. Capture uses the writer lock; copy verification and caller-owned
delivery occur after release. No source recovery, remote uploader or portable-core
export is added. See `audit-evidence.md` for limits, partial output and trust boundaries.

The read-only `audit-diagnose <directory>` CLI reports bounded, redacted observations
of chained audit storage. It does not recover, clean or create storage and adds no
root/core exports. See `audit-diagnosis.md` for limits and observation/trust boundaries.

Provider options `auditCorrelation` and `onAuditOutcome` add opt-in candidate-event
IDs and at-return audit outcomes. `AuditWriteOutcome` and `ProviderAuditOutcome` are
root type exports, not portable-core APIs. See `audit-failure-policy.md` for privacy,
acknowledgment semantics and the provider/SDK/business boundary.

`createWatchedLocalProvider`, `WatchedLocalProviderOptions` and `WatchedLocalProvider`
connect unsigned JSON/YAML monitoring, one initial load, provider status/diagnostics
and SDK-linked shutdown. Automatic unchanged filtering and freshness keep existing
meanings. See `watched-provider.md`; the low-level watcher remains caller-owned.

`createManagedLocalProvider`, `ManagedLocalProviderOptions` and `ManagedLocalProvider`
add opt-in signed-source composition, authenticated startup recovery, explicit
single-flight polling and SDK-linked shutdown. Defaults omit ambient env overrides
and context names. See `managed-provider.md`; lower-level APIs keep their contracts.

Authoring support adds JSON-only package subpaths `/schemas/v1.json` and
`/schemas/v2.json`, with no new root/core runtime exports. The read-only
`generate-types <file> [--format auto|json|yaml]` CLI validates before emitting
standalone flag-key and declared-value types. See `authoring.md` for semantic
validation boundaries, override-safe types and output replacement guidance.

P3 object delivery adds `createS3SnapshotSource`, `S3SnapshotClient` and
`S3SnapshotSourceOptions`; see `s3-snapshots.md`. Caller-owned AWS SDK v3 clients
provide S3/R2 transport and credentials, without a library SDK runtime dependency.

P3 scheduled rollout adds `ScheduledRollout`, `ScheduleEvaluation`, optional v2 flag
`schedule`, request `evaluationTime`, provider `clock`, and optional schedule
decision metadata on evaluation/explanation/audit/replay. No new runtime export or
timer is added. See `scheduled-rollout.md` for priority, bounds and clock trust.

P3 adds `createHmacAuditPseudonymizer`, `AuditPseudonym`, `AuditPseudonymizer` and
`HmacAuditPseudonymizerOptions`. Provider option `auditPseudonymizer` and event
option `pseudonymizer` opt into optional `AuditEvent.pseudonym`; defaults stay
uncorrelated. See `audit-pseudonyms.md` for secret ownership and chain compatibility.

The P2 prerelease adds `ObservableLocalProvider`, `ProviderStatus`,
`ProviderAuditStatus` and `RefreshFailureKind`. Both factories expose
`getStatus()` and `reportRefreshFailure(kind)`; `LocalProviderOptions.staleAfterMs`
opts into age reporting. See `operational-status.md` for counter and privacy semantics.
The audit policy adds `AuditFailurePolicy`, optional
`LocalProviderOptions.auditFailurePolicy` / `auditTimeoutMs` / `auditShutdownTimeoutMs`, optional
`AuditSink.writeConfirmed` and `ProviderAuditStatus.timedOutWrites`.
See `audit-failure-policy.md` for the default-preserving opt-in contract.
Optional metrics add `createOpenTelemetryMetrics`, `OpenTelemetryMeter`,
`ProviderMetrics`, `ProviderMetricsSession`, `ProviderEvaluationMetric` and
`LocalProviderOptions.metrics`; see `opentelemetry-metrics.md`.
Caller-triggered delivery adds `createHttpsSnapshotSource` and
`createSnapshotRefresher`, with the seven source/refresher contract types below;
see `https-snapshots.md`. Provider resolution remains local. Optional
`SnapshotRefresher.refresh({ signal })` cancels only that caller's wait; ordinary
`refresh()` calls still share one promise and operation.
`SnapshotRefresherOptions.timeoutMs` bounds shared waiting (30,000 ms default), while
ownership remains held until actual I/O settles. Optional `onFailure` provides
sensitive original causes only to trusted operator callbacks; ordinary errors stay
sanitized. `SignedSnapshotStore.load({ signal }?)` accepts optional read cancellation;
existing no-argument stores remain compatible. See the delivery/recovery contracts
for unknown commit outcomes and explicit reconciliation.
Optional signed delivery adds `signFlagSnapshot`, `createSnapshotVerifier`,
`SignFlagSnapshotOptions`, `SnapshotVerificationOptions`, `SignedSnapshotMetadata`,
`VerifiedFlagSnapshot` and `SnapshotVerifier`; see `signed-snapshots.md`.
Standalone signed recovery adds `createFileSnapshotStore`, `FileSnapshotStoreOptions`,
`SnapshotRecovery` and `SignedSnapshotStore`; see `snapshot-recovery.md`. Signed
refresher `previous` seeds authenticated continuity independently of active contents.
Optional `store` coordinates durable acceptance before activation through optional
`prepareSnapshot` and `SnapshotUpdateTransaction`; direct evaluations remain local.
Optional initial/update provenance is captured atomically in provider status and
evaluation audit events. Metadata alone is caller-asserted; signature verification
is separate. Unsigned updates clear provenance, including equal-hash updates.

The unpublished 2.0 prerelease adds the root types `ConditionScalar`,
`TargetingCondition`, and `TargetingRule`, snapshot version `1 | 2`, optional
`FlagDefinition.rules` / `disabledVariant`, `EvaluationResult.ruleId`, and reasons
`TARGETING_MATCH` / `DISABLED`. See `flag-file-schema-v2.md` and `migration-to-2.0.md`.
V1 runtime behavior remains supported; exhaustive type consumers must migrate.
It also adds `explainEvaluation`, `EvaluationExplanation`, and `RuleExplanation`;
see `local-inspection.md`. Optional `ruleId` is added to audit/replay records only
when the v2 evaluator selected a rule.
The package CLI adds `evaluate` / `explain`, `simulate`, and `compare` with bounded
local request files and privacy-safe JSON output; their complete contract is in
`local-inspection.md`. No new root simulation export is introduced.

The package-root runtime value surface is exactly:

- `createHmacAuditPseudonymizer`.
- `LocalProviderError` and `isLocalProviderError`.
- `LOCAL_PROVIDER_ERROR_CODES`, `EVALUATION_REASONS`, and `EVALUATION_SOURCES`.
- `createLocalProvider` and `createReloadableLocalProvider`.
- `parseJsonFlagSnapshot`, `parseYamlFlagSnapshot`, `loadFlagSnapshotFile`, and
  `watchFlagSnapshotFile`.
- `createEnvOverrides`, `evaluateFlag`, and `explainEvaluation`.
- `replayEvaluationFixture`.
- `createAuditEvent`, `serializeAuditEvent`, `redactContext`, and `createFileAuditSink`.
- `createOpenTelemetryMetrics`.
- `createHttpsSnapshotSource`, `createS3SnapshotSource` and `createSnapshotRefresher`.
- `signFlagSnapshot` and `createSnapshotVerifier`.
- `createFileSnapshotStore` and `createChainedFileAuditSink`.
- `createAuditChainCheckpoint`, `createChainedAuditEvent`, `verifyAuditChainRecord`
  and `verifyAuditChain`.

The package-root type surface is exactly:

- `LocalProviderError`, `LocalProviderErrorCode`, `EvaluationReason`, and
  `EvaluationSource`.
- `EvaluationRequest`, `EvaluationResult`, `EvaluationContext`, `EnvOverrideState`, and
  `EnvSource`.
- `EvaluationExplanation`, `RuleExplanation`, `ConditionScalar`, `TargetingCondition`,
  and `TargetingRule`.
- `FlagSnapshot`, `FlagDefinition`, `FlagType`, `FlagValue`, `PercentageRolloutRule`,
  `JsonObject`, and `JsonValue`.
- `LocalProviderOptions`, `ReloadableLocalProvider`, `CreateEnvOverridesOptions`,
  `LoadFlagSnapshotFileOptions`, `WatchFlagSnapshotFileOptions`,
  `FlagSnapshotFileWatcher`, and `SnapshotFileFormat`.
- `ObservableLocalProvider`, `ProviderStatus`, `ProviderAuditStatus`, and
  `RefreshFailureKind`.
- `AuditEvent`, `AuditContextKeyMode`, `AuditQueueOverflowPolicy`,
  `AuditRedactionOptions`, `AuditSink`, `AuditWriteMode`, `CreateAuditEventOptions`,
  `FileAuditSinkOptions`, `FileAuditSinkStats`, and `RedactedAuditContext`.
- `AuditFailurePolicy`.
- `AuditPseudonym`, `AuditPseudonymizer`, `HmacAuditPseudonymizerOptions`.
- `ScheduledRollout`, `ScheduleEvaluation`.
- `AuditChainCheckpoint`, `ChainedAuditEvent`, `AuditChainOptions`,
  `VerifyAuditChainOptions`, `AuditChainVerification`, `ChainedFileAuditSinkOptions`,
  `AuditChainFileCheckpoint`, and `ChainedFileAuditSink`.
- `FileSnapshotStoreOptions`, `SnapshotRecovery`, `SignedSnapshotStore`, and
  `SnapshotUpdateTransaction`.
- `OpenTelemetryMeter`, `ProviderMetrics`, `ProviderMetricsSession`, and
  `ProviderEvaluationMetric`.
- `SnapshotSource`, `SnapshotSourceRequest`, `SnapshotSourceResponse`,
  `HttpsSnapshotSourceOptions`, `S3SnapshotClient`, `S3SnapshotSourceOptions`, `SnapshotRefresherOptions`,
  `SnapshotRefreshResult`, and `SnapshotRefresher`.
- `SignFlagSnapshotOptions`, `SnapshotVerificationOptions`, `SignedSnapshotMetadata`,
  `VerifiedFlagSnapshot`, and `SnapshotVerifier`.
- `ReplayExpectedResult`, `ReplayFixture`, `ReplayMismatch`, `ReplayOverrideInput`,
  and `ReplayResult`.

`api/local-provider.api.d.ts` is the reviewed declaration baseline and
`api/local-provider.api.json` owns its package version. `pnpm run api:check` compares both
ESM and CJS declarations, value/type namespaces, dependent declaration shapes, and actual
runtime exports. Baseline updates are explicit release-review actions; CI never rewrites them.

- `createLocalProvider(options)`.
- `createReloadableLocalProvider(options)`.
- `parseJsonFlagSnapshot(json)`.
- `parseYamlFlagSnapshot(yaml)`.
- `loadFlagSnapshotFile(path, options)`.
- `watchFlagSnapshotFile(options)`.
- `evaluateFlag(snapshot, request)`.
- `explainEvaluation(snapshot, request)` (redacted, on-demand explanation).
- `createEnvOverrides(snapshot, options)`.
- `replayEvaluationFixture(fixture)`.
- `createAuditEvent(options)`.
- `serializeAuditEvent(event)`.
- `redactContext(context, options)`.
- `createFileAuditSink(options)`.
- `LocalProviderOptions` with `snapshot`, optional `name`, optional `overridesJson`, and
  optional `maxOverridesJsonBytes`, optional injectable `env`, optional `auditSink`, and
  optional `auditWriteMode`, and optional `auditRedaction`.
- `AuditRedactionOptions` with optional `contextKeys: "names" | "count" | "none"`.
  Omitting `contextKeys` selects `count`; `names` is an explicit metadata-disclosure opt-in.
- `LoadFlagSnapshotFileOptions` with optional `format`, optional `encoding`, and optional
  `maxBytes`. File loads read into separate buffers of at most 64 KiB. Full read buffers
  are retained without a second payload copy; short reads still compact their bytes
  to avoid retaining unused capacity. Final concatenation, byte-limit enforcement,
  strict UTF-8 validation and exception-safe handle cleanup remain in place.
- `WatchFlagSnapshotFileOptions` with optional `debounceMs`, `persistent`, and
  `consistencyPollIntervalMs`. Consistency polling is disabled when omitted; supplied values
  must be integers of at least 50 ms. `debounceMs` defaults to 50 ms and must be an
  integer from 0 through 2,147,483,647. Invalid debounce values reject with RangeError
  before any watcher is acquired or initial file is read, avoiding Node timer clamping.
- `CreateEnvOverridesOptions` with optional `overridesJson`, optional
  `maxOverridesJsonBytes`, and optional injectable `env`.
- `FileAuditSinkOptions` with `path`, optional `createDirectory`, optional `maxBytes`,
  optional `maxFiles`, optional `lock`, optional `lockTimeoutMs`, and optional
  deprecated `staleLockMs` (supplying it throws), optional `maxQueueSize: number | null`, and optional
  `queueOverflowPolicy` and `maxQueueBytes: number | null`. Count defaults to 5,000
  and pending event bytes to 64 MiB; null independently disables that bound.
- `EvaluationRequest` with optional `targetingKey` for rollout evaluation and a
  discriminated `expectedType`/`defaultValue` pair that rejects mismatched caller types.
- `EvaluationResult` with optional `bucket` for deterministic pure-evaluator replay checks.
- Snapshot, flag definition, rollout, evaluation, env override, replay fixture, audit event, audit sink, audit write mode, reason, source, and error code types.
- Audit context output includes the applied `keyMode`; `count` adds `keyCount`, while
  non-`names` modes keep `keys` empty.
- `AuditSink` implementations may expose optional `flush()` to wait for pending writes and
  optional `getStats()` for implementation-specific sink counters. File sinks report
  pending, dropped, and rejected writes plus their effective queue limit and optional
  `pendingBytes` / `maxQueueBytes` payload diagnostics. Custom sinks remain compatible.
- Providers flush an optional audit sink through the OpenFeature `onClose` lifecycle hook;
  waiting at most 5,000 ms by default (`auditShutdownTimeoutMs` overrides this).
  They release events/metrics before waiting and do not close shared sinks.
- Reloadable providers emit OpenFeature `PROVIDER_CONFIGURATION_CHANGED` events after a
  successful semantic snapshot change. `flagsChanged` is a code-unit-sorted list of added,
  removed, or changed flag keys; metadata-only changes use an empty list.
- Snapshot and override hash generation uses locale-independent key ordering.
- `openfeature-local-provider validate <file>` validates a local JSON/YAML snapshot and
  returns exit code `0` on success, `1` on snapshot validation failure, and `2` on usage
  error.

The GitOps recipe in `gitops-snapshots.md` composes existing public APIs; its
executable SDK helpers do not add package-root exports or background scheduling.

Opt-in audit integrity adds `createAuditChainCheckpoint`, `createChainedAuditEvent`,
`verifyAuditChainRecord`, `verifyAuditChain`, `AuditChainCheckpoint`,
`ChainedAuditEvent`, `AuditChainOptions`, `VerifyAuditChainOptions` and
`AuditChainVerification`. Read-only `audit-verify` checks ordered JSON Lines against
an explicit genesis/prefix and optional exact trusted head. Plain sinks remain
unchanged. See `audit-chain.md`. `createChainedFileAuditSink`,
`ChainedFileAuditSinkOptions`, `AuditChainFileCheckpoint` and `ChainedFileAuditSink`
add opt-in segmented storage and verified checkpoint capture.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Package metadata drifts from the accepted package identity.

## Portable subpath

The additive `/core` entry exposes only the evaluation/JSON/error/reason surface
and platform-neutral types in `portable-core.md`, with its separate reviewed
`api/local-provider-core.api.d.ts` baseline. The root surface above is unchanged.
Core has no Node/OpenFeature SDK imports in runtime code or declarations. This
boundary alone does not establish browser/Bun/Deno/Workers runtime support.

The core-only execution matrix is now established separately in `compatibility.md`
and `../testing/core-runtime-acceptance.md`; it does not extend root API support.

HTTPS/S3 source options accept optional `totalTimeoutMs` (1..320,000 ms) to bound
all read attempts and jittered backoff. Omission derives the previous maximum
attempt/backoff envelope. No persistence or activation retries are added.

ChainedFileAuditSinkOptions adds optional batchSize (1..64, default 64) and
maxBatchBytes (1..4 MiB, default 1 MiB). See audit-chain.md for durable completion,
encoded byte splitting and ambiguous group-failure semantics. No new exports.

ChainedFileAuditSinkOptions adds optional onError(error: unknown): void | Promise<void>
for trusted raw storage diagnostics. Callback failures are isolated; see audit-chain.md.

Alpha.111 adds the Node `import-flagd` CLI for the explicitly supported static JSON
subset, with a redacted default report and opt-in complete sensitive output.
Unsupported semantics reject the whole conversion; no root/core API exports or
source files change. See `import-flagd.md`.

Alpha.112 extends TargetingCondition with boolean exists and guarded not. Existing
function signatures/exports, old snapshots and ordinary positive-group behavior remain;
invalidity cannot become a match through complement. See `presence-and-negation.md`.

Alpha.113 adds only the Node compile-segments authoring CLI. It emits validated
inline v2 under reference/cycle/expansion budgets; no root/core exports or runtime
snapshot format changes. See `reusable-conditions.md`.
