# Environment Overrides

Status: Draft
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

## Priority

1. Explicit JSON override map.
2. Explicit per-flag env variable.
3. File static value or percentage rollout.
4. Caller-provided OpenFeature default value.

## Review Blockers

- Auto-generated env names are introduced.
- Env priority changes without migration and compatibility notes.
- Override errors are silently ignored.
- Raw env values are written to audit output by default.
