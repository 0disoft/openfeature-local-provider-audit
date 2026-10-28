# Offline reusable conditions

Local alpha.113 adds a Node CLI authoring helper, not runtime segment storage.
Use it when two or more rules need one shared tenant/version/exclusion predicate;
keep simple configurations inline. No observed production duplication/adoption is
claimed. ADR0016 records the inspected example evidence and the narrow decision.

```json
{
  "authoringVersion": 1,
  "segments": {
    "pilot": { "attribute": ["tenant"], "op": "eq", "value": "pilot" },
    "outsidePilot": { "not": { "segment": "pilot" } }
  },
  "snapshot": {
    "schemaVersion": 2,
    "flags": {
      "feature": {
        "type": "boolean", "variants": { "on": true, "off": false }, "defaultVariant": "off",
        "rules": [{ "id": "pilot", "when": { "segment": "pilot" }, "variant": "on" }]
      }
    }
  }
}
```

```sh
openfeature-local-provider compile-segments authoring.json
openfeature-local-provider compile-segments authoring.json --emit-snapshot
```

The default report contains only ok/schemaVersion/segmentCount/flagCount/expansionVisits.
The explicit emission option prints the entire sensitive validated runtime v2 JSON.
No files are written. On failed emission stdout is empty and stderr is a redacted
`{ok:false,code}` report; ordinary diagnosis failure reports to stdout. Exit codes:
0 success/help, 1 unreadable/unsupported/invalid, 2 argument error. Shell redirection
may truncate a destination before command execution: use a separate new temporary
output, check success and validate before replacing active config. Sign and deploy
the expanded snapshot, not the authoring envelope. Runtime loaders intentionally
reject authoringVersion/segments and unresolved references.

Only exact `{segment:"name"}` condition nodes are references. Names are nonblank
1..128 UTF16 units, resolved by own exact name, including prototype-like names.
Objects elsewhere (including variant JSON with segment keys) remain ordinary data.
All definitions, even unused ones, are checked: unknown references, active-path
cycles, malformed conditions and unknown fields reject the whole compilation.
Repeated references in a DAG are allowed; sharing is not a cycle. No partial output.

Limits apply before allocating an excess expansion node: at most64 definitions;
each definition and rule traversal at most100 visits/8 levels, counting reference
hops as visits and levels as well as expanded all/any/not/leaf nodes. Groups retain
1..20 children and flags at most100 rules. A shared definition is charged at every
occurrence; memoization never bypasses limits. Definition preflight is bounded by
64*100=6400 visits; all actual rule expansions together by10000 visits. Output is
then revalidated with existing runtime and source byte/node/value limits. Thus a
short alias chain or exponential fanout cannot bypass the runtime's existing depth
or work bounds. Conservative reference costs can reject a source whose fully inline
output alone would fit; use a shallower definition structure rather than bypassing
the limits. No runtime/reference lookup overhead is introduced.

Input is JSON only, default10MiB with `--max-bytes N` in1..104857600; canonical
capture limits independently apply. Existing hardened read-only regular-file I/O
checks identity and strict UTF8, closes on failure, and checks ownership where
getuid is available. Trusted parent directories/stopped source writers are assumed;
reads may update access time. No source modification, network, retry, timer, private
key or activation is performed. Expanded snapshots use existing immutable captures.
Inline-equivalent output has the same canonical hash, first-match order, guarded
negation, override priority, audit privacy and replay semantics. Definition names
and unused definitions are not part of the runtime artifact/hash/provenance. Keep
the authoring source separately if its origin/history matters. The local flagd
importer still rejects all targeting; no foreign JsonLogic equivalence is inferred.

## Editor schema and existing type generation

Alpha.114 exports `@0disoft/openfeature-local-provider/schemas/authoring-v1.json`.
Associate the installed file externally in the editor; do not add $schema to this
envelope. All refs are local. Structure includes reference-node syntax, definition
count/name bounds and existing v2 leaves/actions. It deliberately cannot prove
reference existence, cycles, expanded depth/node/total budgets, or semantic variant
references. Always compile, then validate/sign the expanded snapshot. Runtime v1/v2
schemas continue to reject the authoring envelope and unresolved reference nodes.
After successful compilation, existing generate-types accepts the expanded output;
no new TypeScript interface or runtime dependency is introduced.

JSON Schema string length counts code points; the compiler additionally enforces
UTF16-unit name/path/operand limits. Editor acceptance alone is not a safety verdict.
