# Flag File Schema v1

Status: Draft
Repository Type: library

## Purpose

Flag file schema v1 defines the local JSON input accepted by the provider. The schema is
compatibility-sensitive because malformed or changed configuration can alter evaluated
flag values.

## Contract

- JSON is the only MVP file format.
- The top-level document has `schemaVersion: 1` and a `flags` object.
- Every flag has a declared type: `boolean`, `string`, `number`, or `object`.
- Every flag defines variants and a default variant.
- Object flag values are allowed but audit output must not include evaluated object values by default.
- YAML and file watching are deferred and require ADR approval.

## Failure Behavior

- Invalid JSON produces a parse error.
- Invalid schema produces a schema error.
- Unknown flag keys return the caller's OpenFeature default value with default reason metadata.
- Type mismatches return the caller's default value with error reason metadata.

## Review Blockers

- A schema change can alter evaluated values without semver and replay fixture updates.
- Example flag files contain real user identifiers, secrets, endpoints, or production configuration.
- YAML or watcher behavior appears without a new ADR.
