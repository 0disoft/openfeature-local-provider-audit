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
- The top-level document, each flag definition, and each rollout rule reject unknown
  fields so misspelled configuration cannot be silently ignored. Flag names, variant
  names, and metadata keys remain caller-defined dynamic keys.
- Every flag has a declared type: `boolean`, `string`, `number`, or `object`.
- Every flag defines variants and a default variant.
- A flag may define `rollout` as a non-empty ordered array of percentage rules.
- Rollout rule variants must reference existing variants.
- Rollout percentages must be greater than 0, at most 100, support at most three decimal
  places, and total no more than 100.
- Rollout rules for one flag must use at most one shared optional seed.
- Object flag values are allowed but audit output must not include evaluated object values by default.
- Object values in either schema version are limited to 128 nested edges and
  100,000 visited values per tree. Cycles and accessor properties in direct object
  inputs are rejected without invoking getters, with SCHEMA_ERROR.
- Before schema validation, both versions capture only own enumerable data properties
  into fresh containers. Hidden/symbol properties, accessors and sparse or extended
  arrays are rejected. Capture is bounded to 100,000 visited values and 136 edges
  including schema containers; the per-value 128-edge limit still applies. Caller
  array methods and shallow freezing cannot bypass copying or descendant freezing.
- File watching must keep evaluation file-I/O free and preserve the last valid snapshot
  when reload fails.
- Optional consistency polling performs metadata-only idle checks at a caller-selected
  interval of at least 50 ms and reads the snapshot only after its stat fingerprint changes.
- Reload bursts share one pending operation behind the active reload. A manual
  request forces delivery even when unchanged; automatic requests retain error
  reporting. Closing prevents pending/new file reads and returns the last committed
  snapshot to pending/manual requests; an already-started read/callback may finish
  but cannot publish a snapshot after close.
- Error notifications do not hold the reload queue. Async `onError` callbacks may
  repair the file and await `reload()`; callback throws/rejections are isolated.
  Notifications may still be pending when a later reload completes or close returns.

## Failure Behavior

- Invalid JSON or YAML produces a parse error. Default UTF-8 file reads (including
  the explicit utf8/utf-8 aliases) reject malformed byte sequences with PARSE_ERROR
  before schema validation, rather than silently replacing bytes with U+FFFD. Valid
  U+FFFD characters and Unicode split across read chunks remain supported. Explicit
  non-UTF-8 encodings retain their existing decoding behavior. File byte limits and
  their error precedence are unchanged; failed watcher reloads keep the last snapshot.
- Invalid schema produces a schema error.
- Unknown fields at the snapshot, flag-definition, or rollout-rule level produce a
  schema error that names the rejected field.
- Unknown flag keys return the caller's OpenFeature default value with default reason metadata.
- Type mismatches return the caller's default value with error reason metadata.

## Review Blockers

- A schema change can alter evaluated values without semver and replay fixture updates.
- Example flag files contain real user identifiers, secrets, endpoints, or production configuration.
- Watcher behavior reads from disk during each evaluation.
- A failed watcher reload replaces the last valid snapshot.
- YAML input bypasses the same schema validation used by JSON input.
