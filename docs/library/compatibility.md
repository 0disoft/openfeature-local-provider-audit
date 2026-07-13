# Compatibility

Status: Draft
Repository Type: library

## Repository Type Contract

Compatibility means consumers can upgrade without unexplained flag resolution changes.
The most sensitive surfaces are bucketing, env override priority, reason names, audit
event schema, and flag file schema.

Detailed compatibility contracts live in:

- docs/library/flag-file-schema-v1.md
- docs/library/env-overrides.md
- docs/library/bucketing-v1.md
- docs/library/evaluation-reasons.md
- docs/library/audit-event-v1.md
- docs/library/replay-fixture-v1.md

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: package exports and documented provider behavior.
- Semantic versioning policy: behavior that can change evaluated flag values is compatibility-sensitive.
- Runtime and platform compatibility: server-side Node.js 22 LTS and Node.js 24 LTS are the MVP support targets; Bun, browser, Deno, and other runtimes are deferred.
- Package artifact and export surface: consumers must not rely on undocumented internal modules.
- Deprecation and migration policy: compatibility notes must include replay fixture expectations.
- Dependency compatibility: `@openfeature/server-sdk` remains a peer dependency.

## 0.13.0 Audit Context Migration

- Audit context now includes `keyMode: "names"` under the unchanged default policy.
- Consumers with a closed audit-event schema must allow `keyMode` and the optional
  `keyCount` field before upgrading.
- `RedactedAuditContext.keyMode` is optional in the public type so pre-0.13 events and
  existing manually constructed audit objects remain representable.
- Existing `keys` access remains valid. The field is an empty array under `count` and
  `none` modes rather than being removed.
- Consumers that do not configure `auditRedaction` continue to receive sorted context
  key names and never receive raw context values.

## 0.13.1 macOS Watch Reliability

- No public API or snapshot evaluation behavior changes.
- macOS file watching combines native file events for direct writes with directory events
  for atomic replacement. Duplicate native events pass through the existing debounce boundary,
  and event-driven reloads suppress callbacks when the parsed snapshot is unchanged. Explicit
  `reload()` calls retain their existing callback behavior.
- Linux continues to use one native directory watcher, and Windows continues to use bounded
  path polling.

## Compatibility Canary

- Deterministic CI and release checks use the repository-pinned OpenFeature server SDK.
- A weekly compatibility workflow packs the package and installs the newest SDK version allowed
  by `peerDependencies` into a temporary ESM, CJS, and CLI consumer.
- Canary failure blocks widening the peer range or claiming compatibility, but it does not alter
  an already published package or lockfile automatically.

## 0.13.2 Local I/O Hardening

- No public type or snapshot evaluation contract changes.
- macOS rearms its native file watcher after atomic replacement so later direct writes continue
  to use file events instead of relying only on directory-event delivery.
- Native watcher errors are reported through the existing optional `onError` callback. Throwing
  from `onError` remains isolated from watcher and reload state.
- Snapshot loading reads from the same file handle used for its size check and stops at the
  configured `maxBytes` boundary. Exact-boundary files remain accepted.
- Advisory audit locks record an owner token and only the matching owner removes the lock during
  release, preventing an old writer from deleting a replacement owner's lock after stale takeover.

## 0.13.3 Audit And Input Integrity

- No public exports, option names, or evaluation priority rules change.
- File-audit flush retains settled failures until one serialized flush reports them.
- Provider environment input is copied at construction and is not re-read by snapshot updates.
- Prototype-like flag keys use own-property lookup across snapshot and override records.
- YAML alias materialization failures are normalized to `PARSE_ERROR`.
- Same-process sinks serialize writes to one audit path, while cross-process rotation still requires
  `lock: true`.
- New POSIX audit paths use private modes and final file validation rejects symbolic links,
  non-regular files, foreign ownership, and multiple hard links.
- Provider close flushes the configured audit sink without closing a potentially shared sink.

## 0.14.0 Strict Input And Redaction Defaults

- `EvaluationRequest<T>` now correlates `expectedType` with `defaultValue`; code that
  previously declared contradictory pairs must correct one side before it compiles.
- Snapshot root objects, flag definitions, and rollout rules reject unknown fields.
  Remove misspelled or unsupported fields before upgrading. Dynamic flag, variant, and
  metadata keys remain accepted.
- Audit context key disclosure now defaults to `count`. Consumers that intentionally
  depend on sorted key names must set `auditRedaction.contextKeys: "names"`; closed
  event schemas must accept `keyMode: "count"`, `keys: []`, and `keyCount`.
- Raw context values, targeting keys, and evaluated values remain excluded under every
  redaction mode.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Replay fixture drift is accepted without explaining the behavior change.
- Package metadata drifts from docs/adr/0004-package-license-runtime-policy.md.
