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
- Array capture checks its own length descriptor against the remaining shared node
  budget before enumerating keys. An oversized dense array is rejected without
  materializing one key string per slot. Arrays exactly fitting the remaining
  budget retain their existing acceptance; descriptor, density, byte and depth
  checks still apply to arrays that pass this preflight.
- Already validated snapshots from this validator instance may be reused by identity
  during provider creation/reload, avoiding a second full capture and validation.
  Only an internal WeakSet marks its deeply frozen results; caller-created frozen
  objects, clones, proxies and results from another package instance still pass
  through full validation. The first external-input validation and its limits stay
  unchanged. Consumers must not depend on receiving a fresh snapshot identity.
- Optional `envVar` bindings are read only from a flag's own properties, including
  after validation and in indexed override processing. Inherited host prototype
  values/getters cannot introduce an undeclared binding. An explicit binding still
  uses ordinary environment property lookup, including inherited/nonenumerable
  environment names; explicit JSON overrides retain their existing precedence.
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

## Bounded file-read allocation

Snapshot file reads reserve the observed file size plus one EOF-probe byte and
fill that same buffer across short reads. Each read remains capped at 64 KiB;
no whole-file concatenation or per-read compacting copy is needed. If the file
grows after stat, capacity doubles up to `maxBytes + 1`, preserving overflow
checks. Shrinkage decodes only initialized bytes. This shared reader also serves
CLI input/checkpoint reads; encodings and file/cleanup error precedence remain.

For observed size S and bytes read N, requested input capacity is O(S + N), with
geometric growth copying O(N) bytes in total. A truncated file can retain its
larger initial reserve. This is not a total heap/RSS bound: allocator pooling,
decoding/parsing and concurrent callers have separate costs.

A local real-file test read the same 1,024-byte file under the default 10 MiB
limit, with read results capped at 65,536 / 1 / 7 bytes. Cumulative requested
input-buffer lengths were 131,072 / 67,174,400 / 9,699,328 bytes before the change
and 1,025 bytes for each case afterwards. The final 1,024-byte concatenation was
removed. Read calls remain 2 / 1,025 / 148 on that stable file. These are buffer
request counts, not peak RSS, elapsed-time or production short-read claims.

## Failure Behavior

- Invalid JSON or YAML produces a parse error. Default UTF-8 file reads (including
  the explicit utf8/utf-8 aliases) reject malformed byte sequences with PARSE_ERROR
  before schema validation, rather than silently replacing bytes with U+FFFD. Valid
  U+FFFD characters and Unicode split across read chunks remain supported. Explicit
  non-UTF-8 encodings retain their existing decoding behavior. File byte limits and
  their error precedence are unchanged; failed watcher reloads keep the last snapshot.
- A file read/handle-validation failure is preserved when handle close succeeds.
  If both the operation and close fail, an AggregateError retains them in that order
  and its cause is the original failure. A lone close failure stays unchanged; close
  is attempted once without retry. Direct loader callers and watcher error callbacks
  receive these native diagnostics; CLI failure output continues to omit input details.
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

## Expanded input budget

All snapshot validation (JSON, YAML and direct objects, including the portable core)
limits captured own data to a conservative 100 MiB JSON-encoded UTF-8 byte budget,
in addition to the existing 100,000-node / 136-level capture guards. Object keys,
values, delimiters, JSON escapes and each repeated alias occurrence consume budget;
explicit optional `undefined` conservatively consumes the space of `null`.
Over-budget input is rejected as `SCHEMA_ERROR` before cloning completes or hashing
can materialize an expanded JSON string. This intentionally tightens oversized input
acceptance without changing signatures. Raising file/source `maxBytes` does not
raise this logical input budget.

String weights are calculated without escaped-string or UTF-8-buffer allocation and
memoized only during that capture. Aliases still count every occurrence; memoization
avoids rescanning their scalar contents. Small aliases and accepted snapshots retain
their original values and hashes. Existing YAML alias-count errors stay `PARSE_ERROR`.
The budget is not a process heap cap and does not replace raw I/O limits: YAML/JSON
parsing and other transient allocations still occur before capture.
