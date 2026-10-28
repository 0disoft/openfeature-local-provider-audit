# Static flagd JSON import

Alpha.111 adds a Node CLI command, with no new root/core exports:

```sh
openfeature-local-provider import-flagd flags.flagd.json
openfeature-local-provider import-flagd flags.flagd.json --emit-snapshot
```

The first prints only `{ok, sourceFormat, schemaVersion, flagCount}`. Names, values,
source paths and parser errors are omitted. The second explicitly prints the complete
sensitive local v2 snapshot to stdout on success. It never writes files itself. When
emission fails, stdout is empty and stderr contains a redacted JSON issue. A shell
redirect can still truncate its destination before the CLI starts: use a separate new
temporary file, check exit status and validate it before replacing application config.

Supported source: JSON with root `flags` and optionally `$schema` equal to
`https://flagd.dev/schema/v0/flags.json`. Each flag must contain only `state`,
`variants`, `defaultVariant`; state must be `ENABLED`, variants must be nonempty and
homogeneous boolean/string/finite-number/JSON object-or-array, and the explicit
string default must name an own variant. Null top-level variants are unsupported;
nested JSON null is supported. Local validation enforces existing key/value limits.
Variant keys, values and the named default are preserved; type is inferred, not coerced.

Targeting (including null/empty), metadata, shared evaluators, unknown fields,
disabled flags and absent/null defaults are rejected. According to the official
[flagd reference](https://flagd.dev/reference/flag-definitions/), disabled and
missing/null defaults use the caller's default; mapping these to a configured local
variant would change behavior. No conditions, bucketing, metadata, signatures, audit
identity or fallback-error parity are inferred. This is a deliberately restricted
converter, not a complete foreign-schema validator or an activation tool.

Conversion stops at the first unsupported item; the entire source is rejected and no
partial snapshot is emitted. Issue `{ok:false, code, flagIndex?}` exposes only a stable
code and zero-based flag position, never names or raw errors. Exit codes: 0 supported,
1 invalid/unsupported/unreadable, 2 argument error. Default diagnosis reports success
or rejection to stdout; emission rejection goes to stderr. `--help` prints usage.

`--max-bytes N` accepts integers 1..104857600; default 10485760 bytes. Existing
canonical input/node/depth and local JSON budgets apply independently. The regular source file with one hard link is opened read-only without a pathname-following fallback;
ownership is checked where `getuid` is available. It is strictly decoded as UTF-8
and checked for identity/metadata changes before the handle is closed in cleanup.
Stop source writers first; trusted ancestor directories remain an assumption. This
does not authenticate source contents or sign/activate the output. Reads/conversion
are bounded and linear in source nodes/bytes, with no external fetch, retry or write.
Source metadata checks exclude access time because reading may legitimately update it.
