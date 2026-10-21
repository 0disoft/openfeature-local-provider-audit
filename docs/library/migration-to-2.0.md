# Migration to 2.0 (unpublished development prerelease)

Schema v1 remains supported. Its overrides, hashes, bucket algorithm, default return,
redaction and watcher behavior are preserved. Do not change existing snapshots merely
to upgrade the package. Schema v2 explicitly enables the new contract in
`flag-file-schema-v2.md` and ADR 0013.

The public snapshot version expands from `1` to `1 | 2`; reason unions include
`TARGETING_MATCH` and `DISABLED`. Exhaustive TypeScript switches and assignments to
the literal version `1` need review. This is deliberately a new major version,
currently a local `2.0.0-alpha.4` prerelease, not a public release or stability claim.
Keep a default branch in reason handlers or handle the new reasons explicitly.

Alpha.4 adds operational status. Provider factories now return
`ObservableLocalProvider` (still assignable to OpenFeature `Provider`).
Custom implementations of `ReloadableLocalProvider` must add `getStatus()` and
`reportRefreshFailure(kind)`. Existing constructor options and evaluation behavior
are unchanged; `staleAfterMs` is optional. See `operational-status.md`.

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
