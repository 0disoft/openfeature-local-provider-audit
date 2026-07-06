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

## Package Identity

- Primary package name: `@0disoft/openfeature-local-provider`.
- License: Apache-2.0.
- Package name does not include `audit`; audit remains a built-in capability.

## Candidate Public Exports

- Provider creation API.
- JSON flag snapshot parser.
- Pure flag evaluator.
- Explicit environment override mapper.
- Local provider options.
- Flag snapshot and flag definition types.
- Evaluation request, result, env override state, reason, source, and error code types.
- Audit event and replay fixture types once implemented.

Implementation must not expose internal modules only because examples need convenience imports.

## Implemented Alpha Export Surface

- `createLocalProvider(options)`.
- `parseJsonFlagSnapshot(json)`.
- `evaluateFlag(snapshot, request)`.
- `createEnvOverrides(snapshot, options)`.
- `replayEvaluationFixture(fixture)`.
- `createAuditEvent(options)`.
- `serializeAuditEvent(event)`.
- `redactContext(context)`.
- `createFileAuditSink(options)`.
- `LocalProviderOptions` with `snapshot`, optional `name`, optional `overridesJson`, and
  optional injectable `env`, and optional `auditSink`.
- `EvaluationRequest` with optional `targetingKey` for rollout evaluation.
- `EvaluationResult` with optional `bucket` for deterministic pure-evaluator replay checks.
- Snapshot, flag definition, rollout, evaluation, env override, replay fixture, audit event, audit sink, reason, source, and error code types.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Package metadata drifts from the accepted package identity.
