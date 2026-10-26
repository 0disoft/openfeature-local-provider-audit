# Environment Overrides

Status: Implemented alpha
Repository Type: library

## Purpose

Environment overrides let operators force local flag values without editing the flag file.
The contract must avoid ambiguous automatic environment variable mapping.

## Contract

- Env overrides have priority over file-defined static or rollout values.
- Automatic conversion from flag key to environment variable name is not allowed in MVP.
- Supported override sources must be explicit:
  - A JSON map override source.
  - A per-flag `envVar` name declared in the flag file.
- Override parse failures must be visible as error reason metadata.
- Provider options read overrides at provider creation time. Runtime changes to
  `process.env` or a caller-provided env object do not alter evaluation, including when
  `updateSnapshot()` installs a new snapshot. Create a new provider to refresh overrides.
- Override values never create new flags. Unknown flag keys still return the caller's
  OpenFeature default value with default reason metadata.
- Parsed override state and nested values are frozen, like snapshot values. Clone
  a returned object before modifying it; consumers cannot mutate later evaluations
  or invalidate the provider's cached override hash through a returned reference.

Within one `createEnvOverrides` call, identical object-valued env text can reuse
the last successful object parse. Flags may therefore share deeply frozen object
or array references. Each env binding is still read in flag order; stateful getters,
type-specific errors, and explicit JSON-map precedence retain their behavior.
Only one successful input/result is retained, and separate calls always parse fresh
values. Invalid inputs are not cached. For F flags using the same N-node JSON tree,
JSON parsing and tree validation run once instead of F times, and returned tree
storage falls from O(F*N) to O(N), plus O(F) flag entries. Env binding reads, input
string comparisons, and later per-flag override-hash serialization are not eliminated.

## Priority

1. Explicit JSON override map.
2. Explicit per-flag env variable.
3. File static value or percentage rollout.
4. Caller-provided OpenFeature default value.

## Public API Shape

- `createEnvOverrides(snapshot, { overridesJson, env })` builds an override state for
  pure evaluator calls and tests.
- `createLocalProvider({ snapshot, overridesJson, env })` applies the same override state
  to OpenFeature provider evaluation.
- `overridesJson` must be a JSON object keyed by flag key.
- `overridesJson` is limited to 10 MiB by default. Pass `maxOverridesJsonBytes` to set a
  smaller or larger local-process limit.
- `env` is an injectable environment source for tests and non-`process.env` runtimes.

## Review Blockers

- Auto-generated env names are introduced.
- Env priority changes without migration and compatibility notes.
- Override errors are silently ignored.
- Oversized override input is parsed before size validation.
- Raw env values are written to audit output by default.

JSON values in snapshots and overrides are limited to 128 nested edges and 100,000
visited values per value tree. Cycles and accessor properties in direct object
inputs are rejected without invoking getters. Snapshot violations are SCHEMA_ERROR;
override violations follow the existing visible override-parse error contract.

Array length is checked against the remaining visited-value budget before
enumerating its keys. An oversized array is rejected without allocating a key
string for every slot; JSON text still incurs parsing cost within the byte limit.
The value-tree container itself consumes one node, so a root array can contain at
most 99,999 primitive values, or 99,998 when nested directly in an object.
