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
- Before JSON materialization, reject keys that collide under JSON object-key
  conversion as `PARSE_ERROR`, including scalar aliases. Numeric `1` and string
  `"1"` must not silently overwrite each other. Preserve unambiguous scalar-key
  conversion and resolve aliases in document order, including redefined anchors.
  Reject collection keys and scalar keys that materialize objects; callers must
  quote the intended string property name. The guard visits the unexpanded syntax
  tree once and never follows value aliases or includes key contents in errors.
- Keep parser-native pairwise uniqueness disabled: the pre-materialization guard
  owns duplicate rejection for every JSON mapping, including block/flow syntax
  and maps nested inside sequences. This avoids N(N-1)/2 comparisons in a wide
  mapping while retaining generic `PARSE_ERROR` behavior and average constant-time
  Set lookup per key. Parser syntax errors remain checked before that guard.
- YAML is an additive public API export.
- Snapshot capture additionally enforces the shared 100 MiB expanded JSON-encoded
  UTF-8 budget before clone/hash expansion. Large scalar aliases can exceed this
  budget even below the parser's alias-count limit; they fail as `SCHEMA_ERROR`.
  See `docs/library/flag-file-schema-v1.md`; raw parser/I/O budgets remain separate.
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
