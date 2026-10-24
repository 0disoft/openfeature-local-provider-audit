# Snapshot authoring

JSON/YAML snapshots keep the runtime contract in `flag-file-schema-v1.md` and
`flag-file-schema-v2.md`. `validateFlagSnapshot` and the `validate` CLI remain the
authoritative checks before applying or signing a snapshot.

## Offline editor schemas

The package ships standalone Draft-07 JSON Schemas through these subpaths:

- `@0disoft/openfeature-local-provider/schemas/v1.json`
- `@0disoft/openfeature-local-provider/schemas/v2.json`

Associate the appropriate installed JSON file with your snapshot in the editor's
JSON/YAML schema settings. All references are internal, so validation needs no
network access. For example, VS Code JSON settings can associate a project file:

```json
{
  "json.schemas": [{
    "fileMatch": ["/flags.json"],
    "url": "./node_modules/@0disoft/openfeature-local-provider/schemas/v2.json"
  }]
}
```

Do not add a `$schema` property to the snapshot itself: the runtime rejects unknown
properties. YAML editor association is external too; JSON Schema describes the
parsed document, not YAML syntax, aliases or duplicate-key handling.

Schemas check structure, value types, operators, forbidden attribute paths, sizes,
unknown fields and mutually exclusive actions. They intentionally do not claim to
validate every semantic invariant: variant references, unique rule IDs, shared
rollout seeds, total percentages, three-decimal precision, strict SemVer, ordered
schedule stages, condition depth/node budgets, UTF-16 string limits and file/input
limits remain runtime checks. Always run `openfeature-local-provider validate`
before use; editor acceptance alone is insufficient.

## Maintaining the contract

`scripts/snapshot-schema.mjs` is the schema source. Run `pnpm schemas:generate` to
regenerate packaged files; `pnpm schemas:check` detects semantic drift and is part
of `pnpm check`. The dev-only Ajv conformance tests compile both schemas in strict
mode, compare representative runtime-valid/invalid documents and explicitly cover
semantic checks outside JSON Schema. Ajv is not shipped as a runtime dependency.
Draft-07 provides the required features with broad editor support; see the
[Ajv JSON Schema documentation](https://ajv.js.org/json-schema.html).
