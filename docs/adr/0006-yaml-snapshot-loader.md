# YAML Snapshot Loader

Status: Accepted
Owner: 0disoft

## Context

The package now supports the core JSON snapshot contract and public npm releases. YAML
snapshot loading was intentionally deferred from the MVP so the first release could keep
one canonical schema and avoid parser dependency risk. Consumers may still keep local flag
configuration in YAML, especially for hand-edited development and test fixtures.

## Decision

- Add a YAML loader as a post-MVP extension: `parseYamlFlagSnapshot(yaml)`.
- Keep JSON as the canonical schema contract. YAML input must parse into the same
  `schemaVersion: 1` snapshot object and must pass the same `validateFlagSnapshot`
  boundary used by JSON.
- Use `yaml@2.9.0` as the parser dependency.
- Reject YAML parser errors as `PARSE_ERROR`.
- Normalize parser-library failures raised while materializing aliases through the same
  `PARSE_ERROR` boundary.
- Reject YAML documents that parse successfully but do not satisfy the snapshot schema as
  `SCHEMA_ERROR`.
- Do not add file watching, hot reload, CLI, browser, Bun, Deno, or hosted service
  behavior as part of this decision.

## Compatibility Impact

- Existing JSON input and evaluation output do not change.
- YAML is an additive public API export.
- The evaluated value for a YAML snapshot must match the evaluated value for an equivalent
  JSON snapshot after validation.
- Future YAML parser changes are compatibility-sensitive if they alter accepted input or
  parsed values.

## Dependency Review

- Native `JSON.parse` cannot parse YAML.
- The selected `yaml` package is a dedicated parser/stringifier package, currently
  `2.9.0`, ISC licensed, and has no runtime dependencies.
- The runtime impact is limited to consumers that import or call the YAML loader.
- Rollback path: remove the YAML export in a breaking release or keep the dependency pinned
  while discouraging new YAML usage in migration notes.

## Validation

- Unit tests must cover valid YAML, YAML parser failures, schema validation failures, and
  equivalence with JSON evaluation behavior.
- Package export tests must include `parseYamlFlagSnapshot`.
- Release readiness must keep package metadata, runtime support, and trusted publishing
  checks green.

## Review Blockers

- YAML input bypasses `validateFlagSnapshot`.
- YAML support changes existing JSON evaluation behavior.
- YAML examples include secrets, production endpoints, or real user identifiers.
- File watching, hot reload, CLI, browser, Bun, Deno, or hosted-service behavior enters
  scope through this ADR.
