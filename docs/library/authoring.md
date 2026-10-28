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

Targeting `rule.variant` follows the same nonblank variant-name contract as the
other variant references. It does not inherit the 128-character `rule.id` limit.
The runtime still rejects references to variants that do not exist; removing an
incorrect authoring limit does not relax runtime validation or input budgets.

## Maintaining the contract

`scripts/snapshot-schema.mjs` is the schema source. Run `pnpm schemas:generate` to
regenerate packaged files; `pnpm schemas:check` detects semantic drift and runs
before both root test commands, including existing CI jobs and `pnpm check`. The dev-only Ajv conformance tests compile both schemas in strict
mode, compare representative runtime-valid/invalid documents and explicitly cover
semantic checks outside JSON Schema. Ajv is not shipped as a runtime dependency.
Draft-07 provides the required features with broad editor support; see the
[Ajv JSON Schema documentation](https://ajv.js.org/json-schema.html).

## Generate flag keys and declared value types

```sh
openfeature-local-provider generate-types ./flags.yaml > flags.d.ts.tmp
openfeature-local-provider generate-types ./flags.json --format json
```

The command uses the same bounded, strict JSON/YAML loader and semantic runtime
validator. Only after successful validation does it print standalone declarations
to stdout. Exit codes are 0 success/help, 1 invalid/unreadable snapshot, 2 invalid
arguments. Errors are bounded messages without file contents or paths. No files
are written by the command. Check the exit status before replacing an existing
`flags.d.ts` with the temporary output: shell redirection can truncate a target
even when generation fails.

Generated declarations export `FlagValues`, `FlagKey`, and `FlagValue<K>`. Keys are
quoted/escaped and sorted by UTF-16 code units for deterministic output. Values,
metadata and environment contents are not emitted. Declarations have no imports
and need no provider SDK or Node types. For example:

```ts
import type { FlagKey, FlagValue } from "./flags.js";
const key: FlagKey = "checkout.enabled";
const fallback: FlagValue<typeof key> = false;
```

Primitive values use their declared boolean/string/number type, not a union of
configured variant literals: environment overrides can supply other valid values.
Object values accept JSON objects or arrays, including nested nulls; configured
object shapes are not a guarantee about overrides. Caller defaults on resolution
errors can further widen result types. Empty snapshots produce no valid flag keys.
Regenerate whenever flag keys or declared types change. This provides compile-time
authoring support; it does not alter SDK signatures or replace runtime validation.

## Reusable conditions

For an explicitly shared policy across rules, `compile-segments` accepts a separate
authoring document and emits ordinary validated v2. It rejects cycles and bounded
expansion overflow before activation; see `reusable-conditions.md` and ADR0016.
Runtime schemas and loaders continue to reject unresolved authoring documents.
