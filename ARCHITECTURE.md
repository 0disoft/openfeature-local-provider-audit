# Architecture

Status: Draft

## Boundary

This repository owns local provider evaluation logic, flag configuration parsing,
environment override precedence, deterministic bucketing, evaluation reason metadata,
audit event shape, and replay fixture semantics.

It consumes the OpenFeature provider abstraction and evaluation context concepts. It does
not own a flag management control plane, hosted dashboard, remote polling service,
experiment analysis system, or user segmentation database.

## Runtime Flow

1. The application registers this package as its OpenFeature provider.
2. The provider loads a local flag snapshot from file input and applies documented env overrides.
3. A flag evaluation receives a flag key, default value, and optional evaluation context.
4. The provider validates the flag type, resolves explicit overrides or deterministic buckets, and returns value plus reason metadata.
5. The provider emits a redacted audit event that records the flag key, source, reason, and replay-safe context summary.
6. Snapshot/replay fixtures can re-run the same input to prove deterministic behavior.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: audit logs must avoid raw user context, secrets, access tokens, and unredacted targeting identifiers by default.
- Operability: evaluation reasons, source priority, and replay fixtures must make flag behavior explainable after an incident.
- Compatibility: bucketing, reason names, flag file schema, and public exports are compatibility-sensitive.
