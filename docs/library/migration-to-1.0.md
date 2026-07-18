# Migration to 1.0

Status: Planned candidate guidance
Owner: 0disoft

Current repository package version: `0.16.0`.
Target candidate: `1.0.0-rc.1`.

The target candidate is a plan, not publication evidence. This document does not claim
that `1.0.0-rc.1` exists on npm, that its registry artifact passed installation checks,
or that an independently maintained consumer has completed integration. Those results
must be recorded after publication before stable `1.0.0` promotion.

## Supported starting versions

This guide owns two upgrade paths:

- `0.15.x` to `1.0.0-rc.1`, including the additive `0.16.x` watcher and event surface.
- `0.16.x` to `1.0.0-rc.1`, using `0.16.x` as the direct behavioral baseline.

Earlier `0.x` releases must first apply the compatibility notes for every intervening
minor release. In particular, consumers coming from before `0.15.0` must review the
bounded audit queue migration before using this guide.

## Upgrade from 0.15.x

`0.15.x` already uses a file-audit queue bounded to 5,000 pending writes by default with
`queueOverflowPolicy: "reject"`. Keep monitoring provider warnings or
`rejectedWrites`. Set `maxQueueSize: null` only when deliberately retaining the older
unbounded behavior is worth the process-memory risk. Custom `FileAuditSinkStats`
fixtures must include `rejectedWrites` and `maxQueueSize`.

The `0.16.x` surface included on the way to the candidate is additive:

1. `watchFlagSnapshotFile()` accepts optional `consistencyPollIntervalMs`. Omitting it
   preserves the existing native watch strategy and its resource use. An enabled value
   must be an integer of at least 50 ms.
2. Opted-in consistency polling compares device, inode, modification time, change time,
   and size, then enters the same debounced serialized reload queue as native events.
3. `createReloadableLocalProvider()` emits OpenFeature
   `PROVIDER_CONFIGURATION_CHANGED` after a successful semantic snapshot change.
   `flagsChanged` is a JavaScript code-unit-sorted list of added, removed, or changed
   flag keys. A metadata-only update emits `[]`; invalid or semantically unchanged
   updates emit no event.
4. Provider close removes event handlers. Watcher close stops native watching, optional
   polling, and later callback publication.

Consumers that neither enable consistency polling nor subscribe to configuration-change
events retain their `0.15.x` runtime behavior.

## Upgrade from 0.16.x

`0.16.x` is the direct behavioral baseline for `1.0.0-rc.1`. The candidate must not be
published until any intentional difference from that baseline is listed here with its
old behavior, new behavior, consumer action, replay impact, and rollback path.

At the current repository version there is no approved rename, removal, default change,
schema change, reason change, bucketing change, or audit-event field removal for the
candidate. This statement freezes intent; it does not replace API-surface comparison,
packed-consumer tests, or registry-artifact verification.

## Contracts unchanged for 1.0 RC

The candidate is expected to preserve all of these `0.16.x` contracts:

- Runtime and peer dependency: server-side Node.js 22 and 24, with
  `@openfeature/server-sdk` supplied as peer dependency `^1.22.0`.
- Package boundary: consumers import documented package-root exports only. No internal
  module path becomes public merely for migration convenience.
- Snapshot schema: `schemaVersion: 1`; JSON is canonical, YAML feeds the same validation
  boundary, and unknown snapshot, flag-definition, and rollout-rule fields are rejected.
- Evaluation priority: explicit JSON override, declared per-flag `envVar`, percentage
  rollout, file default variant, then caller-provided default on missing/error paths.
- Bucketing v1: SHA-256 over the UTF-8 encoding of
  `` `${seed}\n${flagKey}\n${targetingKey}` ``, default seed `v1`, first eight digest
  bytes interpreted as unsigned big-endian, and bucket range `0..99999` without Unicode
  normalization.
- Evaluation reasons: `STATIC`, `DEFAULT`, `ENV_OVERRIDE`, `SPLIT`, and `ERROR`.
- Local error codes: `PARSE_ERROR`, `SCHEMA_ERROR`, `FLAG_NOT_FOUND`, `TYPE_MISMATCH`,
  `INVALID_CONTEXT`, `OVERRIDE_PARSE_ERROR`, `PROVIDER_NOT_READY`, and
  `AUDIT_SINK_ERROR`.
- Replay fixture v1: pure-evaluator comparison of value, variant, bucket, reason, source,
  and optional error code; error-message copy remains outside the fixture contract.
- Audit event v1: raw targeting keys, context values, override values, and evaluated flag
  values remain excluded. Context-key disclosure defaults to `count`; `names` is explicit
  opt-in and `none` omits names and count.
- File audit backpressure: 5,000 pending writes and `reject` by default,
  `maxQueueSize: null` as the explicit unbounded choice, and separate cumulative dropped
  and rejected counters.
- Watch and change events: native watch remains primary, consistency polling remains
  opt-in with a 50 ms floor, semantic duplicates stay suppressed, and `flagsChanged`
  ordering remains code-unit deterministic.
- CLI contract: `openfeature-local-provider validate <file>` stays local, read-only, and
  file-based, with exit codes `0` for success, `1` for snapshot failure, and `2` for usage
  error.

## RC install and verification

Before stable promotion, test the exact registry candidate through a normal install path
in a clean consumer that has no workspace link or checkout `dist` dependency. A candidate
install should select the explicit version or npm dist-tag `next`; prereleases must not
replace `latest`.

The registry-installed artifact must exercise ESM, CJS, TypeScript declarations, CLI,
OpenFeature registration and evaluation, environment priority, replay, watcher reload,
configuration-change events, audit redaction, audit sink flush, and shutdown. Record the
package version, registry integrity, consumer repository and commit, Node version,
OpenFeature peer version, platform, commands owned by that consumer, and result.

Repository CI and a packed checkout tarball are pre-publication evidence. They are not a
substitute for installing the exact npm artifact.

## Rollback

During the candidate series, pin the last known-good `0.15.x`, `0.16.x`, or earlier RC
version. Do not retag or republish an RC tarball as stable. If a candidate is defective,
deprecate that prerelease when appropriate, correct the contract or implementation, and
publish a new `rc.N` artifact.

For watcher regressions, omit `consistencyPollIntervalMs` to return to the native strategy
while preparing the corrected candidate. For audit backpressure regressions, choose an
explicit measured finite queue or pin the prior package; `maxQueueSize: null` is a
deliberate risk acceptance, not a general rollback default.

Stable rollback remains consumer-owned package pinning. A rollback that changes snapshot
schema, evaluation results, reason names, audit fields, or replay outputs requires its own
compatibility note rather than a silent downgrade recommendation.

## Evidence map

- Public package contract: [public-api.md](public-api.md)
- Compatibility history: [compatibility.md](compatibility.md)
- Semantic versioning policy: [semver.md](semver.md)
- Snapshot schema v1: [flag-file-schema-v1.md](flag-file-schema-v1.md)
- Bucketing v1: [bucketing-v1.md](bucketing-v1.md)
- Environment priority: [env-overrides.md](env-overrides.md)
- Evaluation reasons: [evaluation-reasons.md](evaluation-reasons.md)
- Replay fixture v1: [replay-fixture-v1.md](replay-fixture-v1.md)
- Audit event v1: [audit-event-v1.md](audit-event-v1.md)
- Configuration-change events: [configuration-change-events.md](configuration-change-events.md)
- Candidate and stable gates: [../product/05-1.0-readiness.md](../product/05-1.0-readiness.md)
- Release procedure: [../ops/release.md](../ops/release.md)
- Rollback policy: [../ops/rollback.md](../ops/rollback.md)

## Evidence status

- Current source baseline: repository package version `0.16.0`.
- Candidate publication: not yet evidenced by this document.
- Exact registry-artifact installation: not yet evidenced by this document.
- Independently maintained consumer result: not yet evidenced by this document.
- Stable `1.0.0` promotion: blocked until the candidate gates and external-consumer gate
  are satisfied.
