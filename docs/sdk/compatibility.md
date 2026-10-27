# SDK Compatibility

Status: Draft
Repository Type: sdk

## Repository Type Contract

SDK compatibility is measured by whether consumer examples continue to register the
provider, resolve sample flags, emit redacted audit events, and replay deterministic
fixtures across documented runtime targets.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- SDK ownership boundary: examples and compatibility notes, not hosted service operations.
- SDK public contract: examples must follow the documented provider API.
- SDK validation evidence: sample flag files and replay fixtures are required for compatibility claims.
- SDK release or rollout policy: private examples are not published; CI must validate them
  against the same workspace package or exact packed/registry artifact under review.
- SDK compatibility and migration policy: mark changed reason names, audit fields, schema, or bucketing behavior as migration-sensitive.

## Implemented Example

- `examples/node-basic` is a private `0.0.0` workspace consumer, not a separately
  published SDK package or version claim.
- `examples/node-basic` registers the provider through OpenFeature, resolves a local
  override and rollout flag, atomically replaces a local snapshot, waits for reload,
  verifies deterministic configuration-change keys, flushes a strict-redaction audit sink,
  and verifies the same rollout path with `replayEvaluationFixture`.
- The Node example exits unsuccessfully when override priority, deterministic replay,
  reload or configuration-event behavior, audit event count, or strict context-key
  redaction drifts.
- The root typecheck includes the Node example so consumer-facing type drift is checked
  separately from its runtime smoke.
- The example context uses synthetic non-personal fields and does not include emails,
  tokens, passwords, or real user identifiers.

## Review Blockers

- SDK examples drift from public API.
- Compatibility claims lack runtime or consumer evidence.

## Portable core only

Local alpha.107 packed `/core` ESM is verified on Chromium 155.0.8059.40,
Bun 1.4.4, Deno 2.9.6 and
local workerd 2026-10-19 on Windows x64. This is the platform-neutral JSON/evaluation
surface, not SDK provider registration, file/audit APIs or a hosted Worker
integration. Exact versions, disabled Node modes, case counts and restrictions are
in `docs/library/compatibility.md` and `docs/testing/core-runtime-acceptance.md`.

The private core-basic example executes against the workspace and, through the
existing contract runner, unchanged in a real tarball-installed consumer. See
`docs/sdk/adoption-guide.md` and `docs/testing/p3-adoption-status.md` for reproducible
commands and the still-unmet independent-use requirement. It is not a published
SDK package or external adopter.
