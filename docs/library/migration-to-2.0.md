# Migration to 2.0 (unpublished development prerelease)

Schema v1 remains supported. Its overrides, hashes, bucket algorithm, default return,
redaction and watcher behavior are preserved. Do not change existing snapshots merely
to upgrade the package. Schema v2 explicitly enables the new contract in
`flag-file-schema-v2.md` and ADR 0013.

The public snapshot version expands from `1` to `1 | 2`; reason unions include
`TARGETING_MATCH` and `DISABLED`. Exhaustive TypeScript switches and assignments to
the literal version `1` need review. This is deliberately a new major version,
currently a local `2.0.0-alpha.8` prerelease, not a public release or stability claim.
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
