# Flag File Schema v1

Status: Draft
Repository Type: library

## Purpose

Flag file schema v1 defines the local JSON-compatible snapshot object accepted by the
provider. JSON remains canonical, and YAML is accepted only as an alternate
serialization that must parse into the same schema. The schema is compatibility-sensitive
because malformed or changed configuration can alter evaluated flag values.

## Contract

- JSON is the canonical file format.
- YAML input is accepted through `parseYamlFlagSnapshot(yaml)` as a post-MVP extension
  approved by docs/adr/0006-yaml-snapshot-loader.md.
- File loading and watch reload are accepted through docs/adr/0007-file-reload-watch.md
  and must feed the same snapshot schema validation boundary.
- The top-level document has `schemaVersion: 1` and a `flags` object.
- Every flag has a declared type: `boolean`, `string`, `number`, or `object`.
- Every flag defines variants and a default variant.
- A flag may define `rollout` as a non-empty ordered array of percentage rules.
- Rollout rule variants must reference existing variants.
- Rollout percentages must be greater than 0, at most 100, support at most three decimal
  places, and total no more than 100.
- Rollout rules for one flag must use at most one shared optional seed.
- Object flag values are allowed but audit output must not include evaluated object values by default.
- File watching must keep evaluation file-I/O free and preserve the last valid snapshot
  when reload fails.

## Failure Behavior

- Invalid JSON or YAML produces a parse error.
- Invalid schema produces a schema error.
- Unknown flag keys return the caller's OpenFeature default value with default reason metadata.
- Type mismatches return the caller's default value with error reason metadata.

## Review Blockers

- A schema change can alter evaluated values without semver and replay fixture updates.
- Example flag files contain real user identifiers, secrets, endpoints, or production configuration.
- Watcher behavior reads from disk during each evaluation.
- A failed watcher reload replaces the last valid snapshot.
- YAML input bypasses the same schema validation used by JSON input.
