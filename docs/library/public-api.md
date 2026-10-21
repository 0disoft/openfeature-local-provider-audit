# Public API

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
`LocalProviderOptions.auditFailurePolicy` / `auditTimeoutMs`, optional
`AuditSink.writeConfirmed` and `ProviderAuditStatus.timedOutWrites`.
See `audit-failure-policy.md` for the default-preserving opt-in contract.
Optional metrics add `createOpenTelemetryMetrics`, `OpenTelemetryMeter`,
`ProviderMetrics`, `ProviderMetricsSession`, `ProviderEvaluationMetric` and
`LocalProviderOptions.metrics`; see `opentelemetry-metrics.md`.
Caller-triggered delivery adds `createHttpsSnapshotSource` and
`createSnapshotRefresher`, with the seven source/refresher contract types below;
see `https-snapshots.md`. Provider resolution remains local.
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
- `createHttpsSnapshotSource` and `createSnapshotRefresher`.
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
  `HttpsSnapshotSourceOptions`, `SnapshotRefresherOptions`,
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
  `maxBytes`.
- `WatchFlagSnapshotFileOptions` with optional `debounceMs`, `persistent`, and
  `consistencyPollIntervalMs`. Consistency polling is disabled when omitted; supplied values
  must be integers of at least 50 ms.
- `CreateEnvOverridesOptions` with optional `overridesJson`, optional
  `maxOverridesJsonBytes`, and optional injectable `env`.
- `FileAuditSinkOptions` with `path`, optional `createDirectory`, optional `maxBytes`,
  optional `maxFiles`, optional `lock`, optional `lockTimeoutMs`, and optional
  `staleLockMs`, optional `maxQueueSize: number | null`, and optional
  `queueOverflowPolicy`. Omitting `maxQueueSize` selects 5,000; `null` explicitly selects
  an unbounded queue.
- `EvaluationRequest` with optional `targetingKey` for rollout evaluation and a
  discriminated `expectedType`/`defaultValue` pair that rejects mismatched caller types.
- `EvaluationResult` with optional `bucket` for deterministic pure-evaluator replay checks.
- Snapshot, flag definition, rollout, evaluation, env override, replay fixture, audit event, audit sink, audit write mode, reason, source, and error code types.
- Audit context output includes the applied `keyMode`; `count` adds `keyCount`, while
  non-`names` modes keep `keys` empty.
- `AuditSink` implementations may expose optional `flush()` to wait for pending writes and
  optional `getStats()` for implementation-specific sink counters. File sinks report
  pending, dropped, and rejected writes plus their effective queue limit.
- Providers flush an optional audit sink through the OpenFeature `onClose` lifecycle hook;
  they do not close or take exclusive ownership of shared sinks.
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
