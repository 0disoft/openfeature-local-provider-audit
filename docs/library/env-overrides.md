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
