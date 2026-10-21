# Migration to 2.0 (unpublished development prerelease)

Schema v1 remains supported. Its overrides, hashes, bucket algorithm, default return,
redaction and watcher behavior are preserved. Do not change existing snapshots merely
to upgrade the package. Schema v2 explicitly enables the new contract in
`flag-file-schema-v2.md` and ADR 0013.

The public snapshot version expands from `1` to `1 | 2`; reason unions include
`TARGETING_MATCH` and `DISABLED`. Exhaustive TypeScript switches and assignments to
the literal version `1` need review. This is deliberately a new major version,
currently a local `2.0.0-alpha.13` prerelease, not a public release or stability claim.
Keep a default branch in reason handlers or handle the new reasons explicitly.

Alpha.4 adds operational status. Provider factories now return
`ObservableLocalProvider` (still assignable to OpenFeature `Provider`).
Custom implementations of `ReloadableLocalProvider` must add `getStatus()` and
`reportRefreshFailure(kind)`. Existing constructor options and evaluation behavior
are unchanged; `staleAfterMs` is optional. See `operational-status.md`.

Alpha.5 adds optional audit failure policy and asynchronous wait limits. Defaults
are unchanged. Custom sinks only need the new optional `writeConfirmed` capability
when opting into `returnDefault`; ordinary `write` keeps its `Promise<void>` type
and overflow policy. Custom operational status implementations add the
`timedOutWrites` counter. See `audit-failure-policy.md` before selecting a safe
caller default or assuming any durability/business-enforcement guarantee.

Alpha.6 adds optional `metrics` and `createOpenTelemetryMetrics(meter)`; omit it
to retain uninstrumented operation. The structural `OpenTelemetryMeter` type keeps
telemetry packages out of consumer dependencies and declarations. Only development
tests install the real Apache-2.0 API 1 / metrics SDK 2 within stable major ranges.
The lockfile selects published versions past the repository's release-age policy;
fresh API 1.10 / SDK 3 were not allowed through an exception. No collector/exporter,
global SDK, timer or OpenTelemetry runtime dependency is installed by the adapter.
See `opentelemetry-metrics.md` for collection, labels and lifecycle.

Alpha.7 adds caller-triggered HTTPS delivery through `createHttpsSnapshotSource`
and `createSnapshotRefresher`, with the source/request/response/options/result
interfaces in `https-snapshots.md`. Existing local file/evaluation APIs are unchanged;
no evaluation performs a fetch and no automatic refresh is enabled. No runtime
dependency was added. Source transport failures use existing `PROVIDER_NOT_READY`;
the active last good provider remains available. Signing and durable recovery are
not claimed by this transport slice.

Alpha.8 adds optional signed JWS delivery, `signFlagSnapshot`,
`createSnapshotVerifier` and five signing/verification/provenance types.
`SnapshotRefresherOptions.verifier` opts in; ordinary JSON/YAML refresh is unchanged.
Custom `SnapshotRefresher` implementations add `getProvenance()`.
`SnapshotRefreshResult.provenance` is optional. Use native Ed25519 KeyObjects for
signing, pinned public keys for verification and current deployment-specific
audience/freshness policy. No JOSE or other runtime dependency is added. See
`signed-snapshots.md` before rotation, rollback or reconstructing process-local
replay state. Persistent restart recovery is still a separate pending slice.
The protected algorithm identifier is fully specified `Ed25519` under RFC 9864;
the deprecated polymorphic `EdDSA` identifier is not accepted by this new profile.

Alpha.9 adds optional provenance to initial provider options, provider status,
audit events and audit event options, and an optional second `updateSnapshot`
argument. Existing one-argument calls remain valid and clear signed origin, even
for equal contents. Custom reloadable providers used by signed refreshers must
atomically expose the supplied provenance; otherwise refresh fails closed. These
fields validate metadata shape/hash, not signatures. Follow `signed-snapshots.md`.

Alpha.10 adds the optional standalone file snapshot store and three store/recovery
types. `SnapshotRefresherOptions.previous` restores an authenticated durable floor;
it requires a verifier and cannot contradict an equal-sequence initial origin.
`load()` exposes expired history only as historical evidence, with no fresh `current`.
Existing providers/refresher defaults perform no storage I/O. See
`snapshot-recovery.md` for bounds, storage trust, crash/lock recovery and the pending
automatic coordination between persistence and active provider application.

Alpha.11 adds optional `SnapshotRefresherOptions.store`, provider capability
`prepareSnapshot` and `SnapshotUpdateTransaction`. Only durable refresh requires
this capability and a signed verifier; ordinary custom providers remain compatible.
Native providers reserve updates during storage while serving old evaluations.
Store acceptance precedes activation and is not undone by close or later application
callbacks. Failed preparation never persists; failed/ambiguous storage never activates
and a subsequent refresh reloads the floor. Post-storage expiry also blocks activation.
See `snapshot-recovery.md`; the existing no-store behavior is preserved.

Alpha.12 adds an executable SDK GitOps recipe and targeted `smoke:gitops` runner.
Package-root exports and existing consumer behavior are unchanged. See
`gitops-snapshots.md` for publisher ownership, first-start/recovery policy, history
rollback, public-key rotation and the local-only delivery proof.

Alpha.13 adds opt-in audit chain primitives and `audit-verify` without changing
plain AuditEvent/file sink output. Four helpers and five contract types capture
redacted events, verify consecutive links and compare explicit trusted checkpoints.
Unknown/accessor/raw fields are rejected. See `audit-chain.md` for canonical bytes,
bounds and authenticity/truncation limits. Chained file writing/rotation remains
pending; ordinary sinks do not automatically acquire a chain.

V2 `disabledVariant` outranks overrides, including malformed overrides. V1 has no
emergency field and keeps its old precedence. Targeting first-match order, missing
attribute behavior and conditional rollout fallback are explicit in the v2 contract.
`localProviderRuleId` in OpenFeature flag metadata is provider-owned when a rule is
selected; do not use that key for application metadata. Rule IDs must not be personal.

Strict app-version comparisons use runtime dependency `semver` (ISC license) within
major 7; `@types/semver` is development-only. It has no native component and performs
no I/O. Existing YAML remains the only other direct runtime dependency. This avoids
maintaining a second SemVer precedence implementation. New major dependency updates
require deliberate review. Audit the declaration and lockfile together.

Rollback: first deploy v1 configuration, then revert to the previous provider.
Older providers reject v2; they must never silently evaluate it as v1. No push,
tag, npm publication, or hosted compatibility result is implied by local verification.
