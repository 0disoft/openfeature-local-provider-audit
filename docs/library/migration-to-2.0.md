# Migration to 2.0 (development prerelease)

Schema v1 remains supported. Its overrides, hashes, bucket algorithm, default return,
redaction and watcher behavior are preserved. Do not change existing snapshots merely
to upgrade the package. Schema v2 explicitly enables the new contract in
`flag-file-schema-v2.md` and ADR 0013.

The public snapshot version expands from `1` to `1 | 2`; reason unions include
`TARGETING_MATCH` and `DISABLED`. Exhaustive TypeScript switches and assignments to
the literal version `1` need review. This is deliberately a new major version,
currently `2.0.0-alpha.120`. Published prereleases use npm `next`; this is not a
stable 2.0 release. See `docs/ops/release.md` for publication gates.
Keep a default branch in reason handlers or handle the new reasons explicitly.

Alpha.120 removes the YAML parser's pairwise duplicate-key scan. The existing
pre-materialization JSON-key guard remains the sole mapping-key uniqueness boundary,
using per-mapping Sets and document-order anchor lookup. Both block and flow maps,
including nested array elements, still reject duplicate/colliding keys as `PARSE_ERROR`.
Unambiguous contents, scalar/alias semantics, public signatures and errors are unchanged.
The removed scan compared N(N-1)/2 key pairs for a mapping with N unique keys;
this is a key-uniqueness optimization, not a whole-parser complexity guarantee.

Alpha.119 rejects YAML mapping keys that collide after JSON object-key conversion,
including scalar aliases, before any entry can be overwritten. For example, `1`
and `"1"` in one mapping now fail as `PARSE_ERROR`. Unambiguous scalar-key coercion
and scalar value/key aliases are preserved, including anchor redefinition. Collection
keys and scalar keys that convert to objects are rejected; quote the intended string
property name instead. This applies to every mapping in both snapshot versions and
to file loading/watching through the shared parser. JSON and public signatures are unchanged.

Alpha.118 checks HTTPS/S3 read completion against both the per-attempt and total
monotonic deadlines, including exact equality. A delayed timer cannot approve a
late content or conditional-not-modified response. Each retry gets a fresh attempt
budget within the original total deadline; existing attempt/backoff bounds and
cancellation precedence remain. Synchronous work still cannot be preempted.
Public signatures and error codes are unchanged; persistence and activation do not retry.

Alpha.117 rejects local file reads whose opened-handle size or nanosecond modification
time changes before EOF, or whose change time changes while the inode remains linked.
This prevents observed mixed-version reads from reaching snapshot validation. Failed
reloads preserve the last good snapshot; retries remain explicit or notification-driven.
One final handle stat is added; public signatures and byte limits are unchanged.
Atomic replacement can still return the complete old inode where the OS permits it.

Alpha.116 indexes the scalar types of validator-owned wide membership operands,
removing repeated candidate-type scans under guarded negation. Wrong/missing types
remain invalid, mutable/caller-frozen arrays remain live, and candidate order,
duplicates, hashes, rules, exports and public signatures are unchanged.

Alpha.115 starts blocking audit budgets before event creation/sink invocation and
checks completion against a monotonic deadline, including shutdown flushes. A delayed
timer cannot turn an expired wait into a confirmation or successful shutdown. Exact
deadline equality expires; synchronous work and underlying I/O remain uninterruptible.
Public signatures, event payloads and non-blocking writes remain unchanged.

Alpha.114 exports offline `schemas/authoring-v1.json` for reusable-condition source
editing, generated from the same v2 condition definitions. It checks structure only;
compilation remains required for reference/cycle/expanded-budget semantics. Existing
v1/v2 runtime schemas and runtime exports remain unchanged.

Alpha.113 adds the offline `compile-segments` authoring CLI. References expand under
cycle/depth/per-rule/global budgets into ordinary v2; runtime formats/exports and
old hashes remain unchanged. See `reusable-conditions.md` and ADR0016.

Alpha.112 adds v2 `exists` and guarded `not` conditions. Invalid/unsafe/wrong-type
observations never become matches through negation; positive groups and old snapshots
retain their behavior. Upgrade evaluators/replay tools before using the new forms;
see `presence-and-negation.md` for the truth table and bounded traversal contract.

Alpha.111 adds read-only static `import-flagd` conversion with a redacted default
report, explicit sensitive output and whole-file rejection on unsupported semantics.
Root/core exports and existing local snapshots remain unchanged; see `import-flagd.md`.

Alpha.110 adds opt-in v2 literal startsWith/endsWith conditions (case-sensitive,
nonempty operands, at most 4096 UTF-16 units, no regex/coercion/normalization).
Old snapshots retain their hashes and behavior; older packages reject the new
operators. Upgrade evaluators/replay tools before delivering them. See schema v2.

Alpha.109 adds the bounded read-only `snapshot-diagnose` CLI. Structure-only
observations make no signature claim; optional public verification settings check
the historical head/floor, retained history order and fresh activation policy.
Observed locks/replacement withhold verdicts. No recovery, cleanup, state activation
or root/core exports are added; see `snapshot-diagnosis.md`.

Alpha.108 adds opt-in `snapshotExpiryPolicy: "returnDefault"` to Node providers.
At active signed expiry or invalid trusted time, typed calls return their original
default with PROVIDER_NOT_READY. Captured-artifact checks run initially and after
audit waiting; observed expiry survives clock rollback and identical-provenance
updates. Default last-good behavior, unsigned snapshots and portable core remain
unchanged. See `active-snapshot-expiry.md` for audit and callback boundaries.

Alpha.107 bounds release-tool registry verification to three minutes with up to
36 read-only attempts. Each complete metadata/tarball attempt has a 15-second budget;
transient propagation failures retry, while authentication, malformed metadata and
candidate-byte mismatches stop immediately. No provider API changes or additional
publication attempts are introduced; see `../ops/release.md`.

Alpha.106 adds Node-only `exportChainedAuditEvidence`: exact retained source files
are copied under the writer lock, then verified outside it before checkpoints and
a completion inventory are published. Existing destinations are rejected and failed
partial exports preserved. No source recovery or network delivery is added; see
`audit-evidence.md` for bounds, cancellation and unauthenticated checkpoints.

Alpha.105 adds the read-only `audit-diagnose` command. It inspects bounded chained
audit storage without taking locks, changing evidence or invoking recovery; busy
and detected concurrent changes withhold a definitive verdict. See `audit-diagnosis.md`.

Alpha.104 adds opt-in audit correlation metadata and a redacted provider-outcome
observer. Candidate audit records remain unchanged; ordinary submission, confirmed
writing, failure and timeout have distinct meanings. SDK hooks and business execution
remain separate boundaries. See `audit-failure-policy.md`.

Alpha.103 checks macOS direct-watch targets before native registration, both at
startup and when rearming after replacement. Non-regular targets reject instead
of entering a potentially blocking native FIFO watch. Regular-file symlink targets,
directory cleanup and last-good state remain supported. See ADR 0007.

Alpha.102 caps audit lock retry sleeps by the remaining monotonic wait budget
and checks that budget before retrying an exclusive open. Late wakes cannot begin
a new acquisition attempt after expiry; the initial zero-wait attempt, ownership
cleanup and initialization failure semantics remain. See `audit-event-v1.md`.

Alpha.101 checks the managed startup recovery deadline after synchronous recovery
finishes. Expired results cannot construct a provider or bind metrics while the
event loop postpones the timer. Cancellation, generic errors and resource cleanup
remain unchanged; synchronous work is not preempted. See `managed-provider.md`.

Alpha.100 rechecks signed snapshot time policy after validation, copying and hashing.
Expiry, max-age and invalid-clock failures during synchronous processing cannot
return a fresh verified snapshot. Early rejection, generic errors, signatures and
historical replay-floor recovery retain their contracts; see `signed-snapshots.md`.

Alpha.99 evaluates each CLI batch request immediately and retains only decisions.
Completed requests no longer retain full snapshot-wide override maps. Input limits,
independent before/after bindings, report ordering, errors and exit codes remain
unchanged; see `local-inspection.md` for the memory bound and remaining work.

Alpha.98 checks the refresh budget with a monotonic clock at phase boundaries,
including after synchronous validation/verification and before durable activation.
A blocked event loop cannot silently skip expiry because its timer has not run.
Expiry still reports once, preserves last-good active state before application,
and never retries or rolls back persistence. Running synchronous callbacks remain
non-preemptible; see `https-snapshots.md` and `snapshot-recovery.md`.

Alpha.97 reuses the last successful object env parse within one override creation.
Flags using identical JSON may share deeply frozen object/array references; clone
returned values before modifying them. Each binding is still read in flag order,
type-specific errors and JSON-map priority are preserved, and separate creations
do not share parsed objects. The cache retains at most one input/result; see
`env-overrides.md`. Public signatures and override hashes retain their contracts.

Alpha.96 escapes terminal controls, Unicode line/paragraph separators and bidi
controls in human-readable validation errors, usage fields and validated file paths.
Untrusted snapshot field names cannot inject terminal commands or diagnostic lines.
Ordinary Unicode, framing/help newlines, exit codes and JSON wire values retain
their behavior; this is display escaping, not identifier/value redaction. See
`docs/security/privacy-and-redaction.md`.

Alpha.95 avoids parsing, snapshot validation and serialization on automatic file
notifications whose decoded input matches the last accepted SHA-256 fingerprint.
The fingerprint hashes UTF-16 code units to preserve lone surrogates under explicit
legacy decoding. File reads, size/encoding checks, explicit reload revalidation,
last-good state and callback failure retries retain their contracts. Only one
fingerprint is retained per watcher; see `operational-status.md`.

Alpha.94 isolates Promise-like results mistakenly returned by synchronous metrics
binding. Rejections are observed without blocking registration or shutdown; late
sessions are never adopted and their close method is called once, including after
provider shutdown. Cleanup rejection is isolated; normal synchronous sessions retain
their lifecycle and public signatures.

Alpha.93 omits Promise-like results mistakenly returned by synchronous custom sink
`getStats()` diagnostics and observes their rejections without awaiting them.
Rejected or never-settling diagnostics cannot delay status reads, evaluation or
shutdown; valid synchronous counters and public signatures remain unchanged.

Alpha.92 retains fragments during chained-audit tip discovery, reading only the
new prefix when the search window doubles. Short reads, terminal LF, the bounded
record window, committed offsets and subsequent hash validation retain their
behavior. Fragments are local to one discovery; no cross-operation file cache is used.

Alpha.91 checks projected payload base64url size before allocating the signer's
UTF-8 payload buffer and encoded segment. Inclusive limits, canonical signed bytes,
validation order and the existing RangeError remain compatible; JSON serialization
is still required to measure payload size.

Alpha.90 discovers existing backups for plain file rotation retaining at least 64
files, avoiding numbered rename attempts on missing paths. Descending movement,
gaps, exact numeric names and Windows case aliases retain their behavior. Directory
permission denial falls back to numbered lookup; default small retention is unchanged.

Alpha.89 reuses verified frozen checkpoints within iterable audit-chain verification.
The start and optional expected head are still captured before iteration, and every
record retains all validation. Standalone record verification continues to capture
arbitrary caller checkpoints; public signatures and canonical bytes are unchanged.

Alpha.88 rejects non-index array keys that mask missing enumerable data slots.
Replay now reports these malformed shared values as mismatches instead of passing
by identity. Dense arrays, object field names and existing traversal budgets retain
their behavior; no public signature or serialized schema changes.

Alpha.87 checks canonical audit-record size before record hashing. Over-limit JSON
escapes and UTF-8 content no longer incur a discarded record digest; genesis
authentication, accepted bytes, hash values and generic errors remain unchanged.

Alpha.86 uses binary search for schedules with at least 16 stages in validator-owned
immutable snapshots. Caller-owned inputs retain sequential lookup; exact time
boundaries, clock rollback, buckets and decision metadata remain unchanged.

Alpha.85 rejects CLI request arrays exceeding the remaining node budget before
copying their values. The 100,000-node limit, accepted boundary and generic
`REQUEST_LIMIT` diagnostics retain their existing semantics.

Alpha.84 reuses the chained file sink's deeply frozen enqueue-time event capture
when constructing a record. Public record creation and stored-record verification
still validate their inputs; canonical bytes, hashes and queue semantics are unchanged.

Alpha.83 removes one duplicate path-stat operation from nonrotating file audit
appends. Pre-open path validation, opened-handle checks and the separate check
before rotation remain in place; audit records and failure contracts are unchanged.

Alpha.81 checks array length against the remaining snapshot-capture node budget
before key enumeration. Oversized arrays reject without per-index key allocation;
the existing node boundaries, schema errors and accepted inputs remain compatible.
This applies to both schemas and the full/Core entrypoints. See `flag-file-schema-v1.md`.

Alpha.80 bounds compact signed-token splitting to four parts before requiring
exactly three. Fresh and recovery verification reject extra/trailing separators
without separator-count-proportional array allocation. Accepted artifacts and
failure responses remain compatible. See `signed-snapshots.md`.

Alpha.79 avoids unused genesis hashing when capturing positive audit-chain
checkpoints. Zero checkpoints still authenticate genesis; chain IDs, hash syntax,
sequences and record linkage retain their checks. Canonical bytes remain compatible.
See `audit-chain.md`.

Alpha.78 observes Promise-like rejection from custom Meter counter, histogram and
gauge measurements without awaiting optional diagnostics. This prevents those
asynchronous instrument failures escaping as unhandled rejections; synchronous
measurement and registration/cleanup contracts remain. See `opentelemetry-metrics.md`.

Alpha.77 removes repeated validation/copying of plain file-audit records after
enqueue. Both write entrypoints still capture and freeze untrusted inputs before
queuing. Only the sink-owned captures use internal serialization; the public
serializer still validates input and all paths enforce the same 16 MiB wire limit.
See `audit-event-v1.md`.

Alpha.76 retains at most two actual SemVer strings per synchronous evaluation,
avoiding repeated parsing when version attributes alternate. The older entry is
evicted on a third distinct string, and all entries disappear after evaluation.
Rule order, invalid-version behavior, results and public signatures are unchanged.
See `flag-file-schema-v2.md`.

Alpha.75 observes rejected Promise-like return values from optional metrics
recording/cleanup and logger warnings without waiting for them. Synchronous
failures remain isolated, and audit flush failures still propagate under the
existing policy. See `opentelemetry-metrics.md`.

Alpha.74 rejects unsafe integers in active file-audit `maxBytes`, `maxFiles` and
`lockTimeoutMs` policies at construction. In particular, enormous retained-file
counts can prevent a decrementing rotation index from advancing through Number
rounding. Existing negative/fractional/zero validation, supported safe values,
inactive options, record formats and public signatures retain their behavior.
See `audit-event-v1.md`; rotation work remains proportional to retained-file count.

Alpha.73 reuses the canonical audit-chain body JSON for hashing and byte limits,
adding the fixed encoding size of its SHA-256 hash member. This avoids a second
graph copy, sort and serialization solely to count bytes. Canonical hashing,
exact UTF-8 limits, validation/error precedence, wire records and public signatures
are unchanged. See `audit-chain.md`.

Alpha.72 reuses a validator-owned, deeply frozen snapshot when provider creation
or reload passes it through validation again. An internal WeakSet controls this
fast path; caller-created frozen objects and results from another module instance
still undergo full capture and validation. Accepted values, hashes, error codes
and public signatures are unchanged. Snapshot identity may now be shared rather
than copied. See `flag-file-schema-v1.md`.

Alpha.71 reads per-flag `envVar` bindings only from own properties in both direct
and indexed environment override processing. An inherited host prototype field or
getter cannot create an undeclared binding after snapshot validation. Explicit
bindings still read inherited/nonenumerable environment values, and JSON override
precedence, valid configured decisions, hashes and public signatures are unchanged.
This is binding isolation, not process-wide prototype-pollution protection. See
`flag-file-schema-v1.md`.

Alpha.70 reuses one stat-sized input buffer for ordinary snapshot/checkpoint file
reads, fills it across short reads and decodes the initialized prefix without a
whole-file concatenation. Files growing after stat use bounded geometric growth;
shrinking files decode only bytes actually read. Byte limits, UTF-8/legacy decoding,
regular-file checks, symlink support and cleanup/error precedence are unchanged.
See `flag-file-schema-v1.md` for the measured allocation scope.

Alpha.69 uses exact `bigint` device/inode identities when opening managed audit
chain files for writing and when streaming segments for verification/recovery.
Distinct 64-bit IDs no longer compare equal through `number` rounding. Ownership,
single-link and byte-budget checks, close/error handling, record hashes and public
signatures are preserved with no extra filesystem calls. See `audit-chain.md`.

Alpha.68 preserves exact device/inode identities in the signed snapshot recovery
store. Journal opening and lock release request `bigint` stats so distinct 64-bit
file IDs cannot compare equal through JavaScript number rounding. Link counts and
POSIX ownership remain validated; journal size converts to a numeric allocation
only after checking the configured byte bound. Public signatures, signed bytes,
replay policy, error privacy and filesystem call counts are unchanged. See
`snapshot-recovery.md`; checks and removal are still separate filesystem operations.

Alpha.67 compares plain audit lock file identities without precision loss.
Plain audit lock ownership now compares device/inode IDs using `bigint` from
both the acquired handle and the current pathname. Distinct Windows 64-bit IDs
can round to the same JavaScript `number`; a foreign replacement carrying the
same owner record must remain intact. No option, audit record, public API or
filesystem call count changes. The check and removal remain separate operations
in a trusted local directory, not an atomic conditional deletion or fencing lock.

Alpha.66 captures the acquired plain audit lock file identity before writing its
owner record. Failed initialization now removes its own partially written marker,
allowing later acquisition without manual cleanup. Release preserves different
file identities, even empty replacements or copied owner records; normal release
still requires the matching token. Missing identity is preserved for operator
recovery. This is cooperative local locking, not atomic conditional unlink/fencing.
Public signatures, records, no-takeover and no-retry policies remain unchanged.
See `audit-event-v1.md`.

Alpha.65 reads optional selection policies, rollout/schedule seeds, result variants,
flag metadata and global override errors only from own properties. Host prototype
values/getters no longer introduce a disabled switch, rules, rollout or schedule,
reinterpret a targeting rollout or change a default seed after validation. Valid
own configurations, selection order, hashes and public signatures are unchanged.
This is evaluation isolation, not process-wide prototype-pollution protection.
See `flag-file-schema-v2.md`.

Alpha.64 fills a stat-sized snapshot recovery read buffer, grows it geometrically
only when the opened file outgrows that capacity, and decodes the initialized
prefix directly. Short reads no longer retain one 64 KiB block each, and stable
files avoid the final whole-journal concatenation. Strict byte/UTF-8 checks,
signatures, replay-floor verification and cleanup remain unchanged. See
`snapshot-recovery.md` for allocation scope and injected-short-read evidence.

Alpha.63 fills unused audit read-block capacity across short reads and merges
contiguous unfinished-record views. Input-buffer retention no longer multiplies
64 KiB by short-read count. Complete-line decoding, strict byte/UTF-8/BOM/newline
checks, handle cleanup and public signatures are unchanged. See `audit-chain.md`
for memory scope and local injected-short-read evidence.

Alpha.62 folds Windows audit queue keys to lowercase so case-alias paths from one
loaded package instance serialize rotation/append operations together. Original
I/O paths, hashes and public signatures are unchanged; case-sensitive Windows
directories may conservatively serialize separate files. POSIX keys retain case.
Other filesystem aliases and cross-process/package-instance writers still require
consistent paths and cooperating advisory locks. See `audit-event-v1.md`.

Alpha.61 recognizes condition groups only from their own `all`/`any` fields.
Inherited group arrays or getters can no longer reinterpret validated leaf/group
conditions after a host prototype change. Normal rule order, short circuiting,
hashes and public signatures are unchanged. See `flag-file-schema-v2.md`; this
is a condition-dispatch fix, not process-wide prototype-pollution protection.

Alpha.60 reuses derived provider state only when an update passes the exact
current, provider-owned deeply frozen snapshot. Unsigned conditional not-modified
refreshes avoid repeated full validation, override parsing and per-flag hashing.
Freshness, provenance capture/clearing and transaction reservations still run;
caller-frozen copies, equal-content objects and former snapshots take the normal
validation path. No public signatures change. See `operational-status.md`.

Alpha.59 adds a shared 100 MiB expanded input byte budget during snapshot capture,
including repeated YAML scalar aliases, object keys and JSON escaping. Oversized
inputs formerly accepted under node/alias-count limits now fail with `SCHEMA_ERROR`;
raising raw `maxBytes` cannot override it. Signatures and accepted values/hashes are
unchanged. See `flag-file-schema-v1.md` for conservative optional-undefined accounting
and separate raw-parser/heap limitations.

Alpha.58 reuses the last actual SemVer parse within one synchronous evaluation,
including invalid versions, across visited rules/groups. The one-entry slot is
never retained across requests; context reads, selection/trace and public signatures
are unchanged. See `flag-file-schema-v2.md` for O(1) storage and alternating inputs.

Alpha.57 indexes validator-owned rollout arrays of at least 16 entries for logarithmic
selection and cached seed lookup. Buckets, percentages, strict boundaries, default
fallback and public signatures are unchanged. Mutable/unregistered inputs retain the
linear path; indexes do not enter snapshot serialization/hashes. See `bucketing-v1.md`
for startup/storage tradeoffs and local benchmark reproduction.

Alpha.56 batches the default plain JSONL audit path (no rotation/lock) within
64 records / 64 KiB of admitted UTF-8 payload, with larger singleton records.
Confirmations wait for shared append/close and failures remain per-record, without
retry or added fsync. Rotation/locked writes and public signatures are unchanged.
See `audit-event-v1.md` and `audit-failure-policy.md` for ambiguous failure semantics.

Alpha.55 adds opt-in local file composition through `createWatchedLocalProvider`:
one initial read, last-good delivery, nonduplicated failure diagnostics, explicit
reload and SDK-linked watcher/provider shutdown. Existing automatic unchanged
filtering and freshness remain. See `watched-provider.md` for ownership and limits.

Alpha.54 adds an opt-in managed signed-source provider: authenticated startup
recovery, explicit sequential polling, and shutdown shared with OpenFeature.
Existing low-level APIs stay compatible. The helper defaults to no ambient env
and no context names. See `managed-provider.md` for lifecycle and first-start policy.

Alpha.53 bounds HTTPS response bookkeeping by coalescing network fragments into
owned blocks of at most 64 KiB before final concatenation. Byte limits, response
cleanup, conditional responses, retry policy and public signatures are unchanged.

Alpha.52 removes redundant copies of full snapshot-file read buffers. Short reads
still compact their bytes so unused capacity is not retained. File limits, strict
UTF-8 checks, handle cleanup and public signatures are unchanged.

Alpha.51 reuses each targeting condition's parsed SemVer operand while its value
is unchanged. Context versions are still parsed per evaluation; mutable operands
invalidate their own cache entry. The weak cache retains at most one parsed operand
per live condition. SemVer ordering and public signatures are unchanged.

Alpha.50 checks sealed audit segment metadata with lstat instead of opening each
file read/write before append. Type, ownership, single-link and exact-size checks
remain under the mandatory lock. Active-tip recovery and full checkpoint verification
retain descriptor identity checks and cleanup. No public signatures change.

Alpha.49 corrects the authoring schema for targeting rule variant references.
Existing names longer than 128 characters now pass the editor schema, matching
runtime validation. Rule IDs retain their 128-character limit; nonexistent variant
references still fail at runtime. No evaluator or public API signatures change.

Alpha.48 memoizes snapshot hashes only for captured, deeply frozen validator-owned
snapshots. Repeated explanations and direct audit-event creation avoid rehashing
unchanged configuration. Mutable or caller-frozen inputs still recompute hashes.
Hash format, evaluation results and public signatures remain unchanged.

Alpha.47 adds the read-only generate-types CLI for validated JSON/YAML snapshots.
Standalone declarations quote/sort keys and preserve broad declared value types
for environment overrides. No existing evaluator or SDK signatures change.

Alpha.46 adds offline v1/v2 JSON Schema exports and authoring guidance. Runtime
validation remains authoritative for semantic invariants. No evaluator behavior
or existing public TypeScript signatures change.

Alpha.45 adds opt-in compare percentage limits and exit3 for policy rejection.
Default differences still exit0; evaluation/input errors retain exit1 and usage
errors exit2. Optional --diagnostics emits only bounded error categories and a
zero-based request index, never raw requests, values, keys, paths or parse errors.
No public TypeScript signatures change.

Alpha.44 adds an optional-telemetry audit queue byte gauge (unit By) with pending
and bounded_capacity states. Shared sinks are counted once; item-unit states report
unknown/unbounded byte limits so a partial capacity is not mistaken for a total.
Zero byte observations clear previously collected finite values. Existing counts remain.
Both callbacks are released on close or partial registration failure. No signatures change.

Alpha.43 accepts inspection request flag keys longer than 256 characters, matching
the existing snapshot parser and evaluator. Nonempty-key, input byte/node/depth and
request-count limits remain. No existing key is rejected and public signatures stay.

Alpha.42 attempts S3 body and iterator cleanup once per acquired resource when
abort, timeout and finalization converge. Throwing or asynchronous cleanup remains
best effort and never replaces the request outcome. Late response bodies still get
their own cleanup attempt. Public signatures and transport retry policy are unchanged.

Alpha.41 captures the S3 SDK response ETag before asynchronous body consumption.
Client middleware reusing or mutating its response during streaming cannot associate
another version's validator with the delivered bytes and skip the next update. Missing
or invalid initial ETags remain absent; signatures, byte limits and retries are unchanged.

Alpha.40 captures custom source response status and ETag before verification,
persistence or provider callbacks. Later mutation of a reused response cannot attach
a different validator to the applied snapshot and skip a subsequent update. Malformed
ETags are discarded consistently with the built-in transports, leaving the next
request unconditional. Public signatures, content validation and replay rules remain.

Alpha.39 avoids repeatedly serializing identical object pairs in the offline compare
CLI. Equality booleans are cached locally through weak keys; evaluation runs for each
request, and serialized values are not retained. JSON equality, changed decision
counts, ordering, privacy, errors and public signatures remain unchanged.

Alpha.38 attempts all owned watcher cleanups when one release fails, including
polling plus native handles and the two macOS watchers. Compound setup/delivery
and cleanup failures retain the original cause in AggregateError; single errors
keep their identity. Repeated close does not retry ambiguous releases, and polling
startup cleanup no longer closes the macOS directory watcher twice. No signature,
reload ordering, event filtering or default polling behavior changes.

Alpha.37 preserves simultaneous snapshot file read/handle-validation and close
failures as AggregateError, with operation first, close second, and the original
operation as cause. Single failures retain their identity and no close retry is added.
This also covers CLI input readers; CLI output remains sanitized. Existing audit
cleanup semantics use the same internal helper. No public signatures change.

Alpha.36 rejects malformed UTF-8 bytes in file loads/reloads and shared CLI input
reads with PARSE_ERROR. Previously replacement characters could silently change
flag keys, values or request attributes. Repair/re-encode such files, or explicitly
select a supported legacy encoding for snapshot files when intentional. Valid UTF-8,
byte limits, BOM handling, public signatures and last-good watcher state are unchanged.

Alpha.35 validates watcher `debounceMs` as an integer in 0..2,147,483,647 before
opening native/polling resources or reading the initial file. Invalid settings now
reject with RangeError instead of Node silently clamping the delay, including
overflow to 1 ms. Omitted settings retain the 50 ms default; zero remains supported.
Valid settings, event ordering, polling policy and public signatures are unchanged.

Alpha.34 makes provider freshness independent of wall-clock adjustments. Optional
`staleAfterMs` now measures monotonic elapsed time from the last successful refresh,
including unchanged content; failures do not renew it. Status timestamps remain epoch
milliseconds, and evaluation behavior and public signatures are unchanged.

Alpha.26 privately indexes wide validated `in` condition arrays for repeated
membership evaluation. Only validator-owned frozen copies are indexed; direct
caller-provided arrays keep live strict-equality behavior, including after mutation.
Small arrays retain linear lookup. Indexes use weak keys, store configuration only,
and do not appear in snapshots, hashes, traces or exports. Duplicate/order semantics,
first matching rule, numeric/string distinction and all condition limits remain.
No migration action or public signature change is required, including for /core.

Alpha.25 prepares a lazy per-snapshot envVar index for local CLI inspection.
Simulation/comparison no longer scan all flags for each request's env mapping.
Each name maps to all referring flags, with original snapshot order, JSON override
precedence and per-flag parse errors preserved. Before/after indexes are separate,
and each request still parses its own values. Mutable direct API inputs retain the
ordinary uncached path; no public signature, hash, report or error contract changes.

Alpha.24 removes repeated whole-journal serialization while trimming snapshot
history to maxBytes. It retains the same newest contiguous prefix, duplicate/order
rules, JSON property order, UTF-8 bytes and trailing newline. Each examined artifact
is encoded once; processing stops at the first entry that cannot fit. Journal schema,
signature/replay verification, locks, write acknowledgment and recovery are unchanged.
No new public API is added.

Alpha.23 bounds file/chained sink queues by both 5,000 pending writes and 64 MiB
of pending event JSON Lines bytes by default. `maxQueueBytes` accepts a positive
safe integer or null; each null disables only its own bound. To restore the old
fully unbounded policy, explicitly set both maxQueueSize and maxQueueBytes to null.
Existing rejection/drop-newest and confirmed-write semantics apply to either bound.
Byte reservations include active writes and release only after actual settlement,
including failures. Optional FileAuditSinkStats.pendingBytes / maxQueueBytes are
also projected into provider status; custom sinks can keep their old stats shape.
The byte budget counts captured event JSON in UTF-8 plus its newline, not JS heap,
Promise overhead, temporary serialization or chain-envelope/disk bytes. Coordinate
aggregate budgets when creating multiple sinks. No event ordering, hash-chain,
locking, acknowledgment or crash-recovery contract changes.

Alpha.22 adds a shared refresh `timeoutMs` (default 30,000 ms; integer
1..2,147,483,647). Existing call signatures remain valid, but previously unlimited
custom source/store waits now reject at the deadline. Increase the limit explicitly
for slower delivery. Cancellation is cooperative: one owner is retained until the
actual outstanding I/O settles, and repeated refresh calls share the rejected result
while it remains outstanding. A timed-out commit has an unknown outcome, is never
automatically retried, and keeps its provider reservation until actual settlement.
Late matching acceptance advances the replay floor without activating or caching
that delivery. Reconcile through explicit recovery before further writes.
`SignedSnapshotStore.load({ signal }?)` adds optional read cancellation; existing
zero-argument implementations remain compatible. Optional `onFailure` receives
`{ kind, cause, timedOut }` for trusted operator diagnostics, including private raw
causes. Protect this callback as a sensitive logging boundary. Exceptions/rejected
promises from it are ignored. A late commit failure can generate a second diagnostic
after timeout, but the refresh failure counter increments only once. Public errors,
status and audit events retain their sanitized contracts.

Alpha.21 adds optional `totalTimeoutMs` (1..320,000 ms) to HTTPS/S3 sources.
The default total budget equals the former maximum attempts/backoff envelope;
backoff now uses full jitter. Each attempt is capped to the remaining monotonic
budget. Only transport reads retry; persistence and activation are never retried.
Underlying S3 clients must still use maxAttempts: 1 to avoid nested retries.

Alpha.20 bounds provider shutdown flushing to 5,000 ms by default; configure
`auditShutdownTimeoutMs` (1..2,147,483,647) with an audit sink for another limit.
Provider event handlers and metrics are released before waiting. Repeated close
calls share one result. A timeout rejects with `AUDIT_SINK_ERROR`; it neither
cancels pending I/O nor closes a shared sink. Late flush failures remain observed.
Remove `staleLockMs` from file sink settings: supplying it now throws rather than
risk deleting a live owner's lock. Stop all writers before abandoned-lock recovery.
Lock release attempts owned-marker cleanup even if handle close fails.

Alpha.19 adds optional `SnapshotRefresher.refresh({ signal })`. Existing no-argument
calls and return types are unchanged. A caller signal cancels that wait, not the
shared refresh; use `close()` to stop shared fetch/recovery waiting. Abort-ignoring
custom sources can no longer hold that wait open after close, though their own I/O
may continue. Already-started durable commits drain internally; alpha.22 bounds the caller wait.
Watcher `reload()` rejects from its own active `onSnapshot` callback instead of
deadlocking; unrelated callers and post-callback scheduled reloads still work.

Alpha.4 adds operational status. Provider factories now return
`ObservableLocalProvider` (still assignable to OpenFeature `Provider`).
Custom implementations of `ReloadableLocalProvider` must add `getStatus()` and
`reportRefreshFailure(kind)`. Existing constructor options and evaluation behavior
are unchanged; `staleAfterMs` is optional. See `operational-status.md`.

Alpha.5 adds optional audit failure policy and asynchronous wait limits. Defaults
are unchanged. Custom sinks only need the new optional `writeConfirmed` capability
when opting into `returnDefault`; ordinary `write` keeps its `Promise<void>` type
and overflow policy. Custom operational status implementations add the
`timedOutWrites` counter. See `audit-failure-policy.md` before selecting a safe
caller default or assuming any durability/business-enforcement guarantee.

Alpha.6 adds optional `metrics` and `createOpenTelemetryMetrics(meter)`; omit it
to retain uninstrumented operation. The structural `OpenTelemetryMeter` type keeps
telemetry packages out of consumer dependencies and declarations. Only development
tests install the real Apache-2.0 API 1 / metrics SDK 2 within stable major ranges.
The lockfile selects published versions past the repository's release-age policy;
fresh API 1.10 / SDK 3 were not allowed through an exception. No collector/exporter,
global SDK, timer or OpenTelemetry runtime dependency is installed by the adapter.
See `opentelemetry-metrics.md` for collection, labels and lifecycle.

Alpha.7 adds caller-triggered HTTPS delivery through `createHttpsSnapshotSource`
and `createSnapshotRefresher`, with the source/request/response/options/result
interfaces in `https-snapshots.md`. Existing local file/evaluation APIs are unchanged;
no evaluation performs a fetch and no automatic refresh is enabled. No runtime
dependency was added. Source transport failures use existing `PROVIDER_NOT_READY`;
the active last good provider remains available. Signing and durable recovery are
not claimed by this transport slice.

Alpha.8 adds optional signed JWS delivery, `signFlagSnapshot`,
`createSnapshotVerifier` and five signing/verification/provenance types.
`SnapshotRefresherOptions.verifier` opts in; ordinary JSON/YAML refresh is unchanged.
Custom `SnapshotRefresher` implementations add `getProvenance()`.
`SnapshotRefreshResult.provenance` is optional. Use native Ed25519 KeyObjects for
signing, pinned public keys for verification and current deployment-specific
audience/freshness policy. No JOSE or other runtime dependency is added. See
`signed-snapshots.md` before rotation, rollback or reconstructing process-local
replay state. Alpha.10/11 below add persistent restart recovery and durable refresh.
The protected algorithm identifier is fully specified `Ed25519` under RFC 9864;
the deprecated polymorphic `EdDSA` identifier is not accepted by this new profile.

Alpha.9 adds optional provenance to initial provider options, provider status,
audit events and audit event options, and an optional second `updateSnapshot`
argument. Existing one-argument calls remain valid and clear signed origin, even
for equal contents. Custom reloadable providers used by signed refreshers must
atomically expose the supplied provenance; otherwise refresh fails closed. These
fields validate metadata shape/hash, not signatures. Follow `signed-snapshots.md`.

Alpha.10 adds the optional standalone file snapshot store and three store/recovery
types. `SnapshotRefresherOptions.previous` restores an authenticated durable floor;
it requires a verifier and cannot contradict an equal-sequence initial origin.
`load()` exposes expired history only as historical evidence, with no fresh `current`.
Existing providers/refresher defaults perform no storage I/O. See
`snapshot-recovery.md` for bounds, storage trust and crash/lock recovery. Alpha.11
below adds coordination between persistence and active provider application.

Alpha.11 adds optional `SnapshotRefresherOptions.store`, provider capability
`prepareSnapshot` and `SnapshotUpdateTransaction`. Only durable refresh requires
this capability and a signed verifier; ordinary custom providers remain compatible.
Native providers reserve updates during storage while serving old evaluations.
Store acceptance precedes activation and is not undone by close or later application
callbacks. Failed preparation never persists; failed/ambiguous storage never activates
and a subsequent refresh reloads the floor. Post-storage expiry also blocks activation.
See `snapshot-recovery.md`; the existing no-store behavior is preserved.

Alpha.12 adds an executable SDK GitOps recipe and targeted `smoke:gitops` runner.
Package-root exports and existing consumer behavior are unchanged. See
`gitops-snapshots.md` for publisher ownership, first-start/recovery policy, history
rollback, public-key rotation and the local-only delivery proof.

Alpha.13 adds opt-in audit chain primitives and `audit-verify` without changing
plain AuditEvent/file sink output. Four helpers and five contract types capture
redacted events, verify consecutive links and compare explicit trusted checkpoints.
Unknown/accessor/raw fields are rejected. See `audit-chain.md` for canonical bytes,
bounds and authenticity/truncation limits. Alpha.14 below adds chained file writing
and rotation; ordinary sinks do not automatically acquire a chain.

Alpha.14 adds `createChainedFileAuditSink` and three options/checkpoint/sink types.
Its dedicated directory/manifest/segments are separate from the plain file format.
Mandatory advisory locking, bounded rejecting queues, atomic manifest retention,
fsynced records and full retained checkpoint verification define the opt-in contract.
Complete unacknowledged records can be adopted after interruption; partial data
fails closed. See `audit-chain.md` for recovery, external checkpoint trust and
filesystem durability. Existing plain sink queue behavior is shared unchanged.

Alpha.15 adds optional HMAC audit correlation through `createHmacAuditPseudonymizer`,
three contract types, `LocalProviderOptions.auditPseudonymizer`, event options
`pseudonymizer` and `AuditEvent.pseudonym`. Defaults stay uncorrelated and existing
chain bytes remain unchanged. When opting in, upgrade chain verification with the
writer: old alpha verifiers reject unknown pseudonym fields. See
`audit-pseudonyms.md` for key/scope isolation, rotation, Unicode limits and privacy.

Alpha.16 adds optional schema-v2 `schedule`, request `evaluationTime`, provider
`clock`, two contract types and schedule metadata on results/explanations/audit/
replay. Existing snapshot behavior is unchanged when schedule is absent. Pure
scheduled evaluation requires explicit time; providers default to Date.now and
never use a context-supplied clock. Upgrade chain verification alongside opt-in
writers. See `scheduled-rollout.md` before using stages, replay or clock rollback.

V2 `disabledVariant` outranks overrides, including malformed overrides. V1 has no
emergency field and keeps its old precedence. Targeting first-match order, missing
attribute behavior and conditional rollout fallback are explicit in the v2 contract.
`localProviderRuleId` in OpenFeature flag metadata is provider-owned when a rule is
selected; do not use that key for application metadata. Rule IDs must not be personal.

Strict app-version comparisons use runtime dependency `semver` (ISC license) within
major 7; `@types/semver` is development-only. It has no native component and performs
no I/O. Existing YAML remains the only other direct runtime dependency. This avoids
maintaining a second SemVer precedence implementation. New major dependency updates
require deliberate review. Audit the declaration and lockfile together.

Rollback: first deploy v1 configuration, then revert to the previous provider.
Older providers reject v2; they must never silently evaluate it as v1. No push,
tag, npm publication, or hosted compatibility result is implied by local verification.

Alpha.17 adds opt-in `createS3SnapshotSource`, `S3SnapshotClient` and
`S3SnapshotSourceOptions`. Callers own their SDK client, credentials and HTTPS
endpoint. No SDK runtime dependency or automatic I/O is introduced; existing
refresher/verifier/store composition is unchanged. See `s3-snapshots.md`.

Alpha.18 adds the deliberate `/core` subpath for synchronous evaluation and JSON
snapshot parsing with platform-neutral types. Root provider/file/audit/inspection
APIs remain Node-only. Native Node bucketing stays SHA-256 compatible with the
portable implementation; no request or schema migration is required. New packaged
core and bundled dependency notices increase artifact size. See `portable-core.md`;
non-Node support remains pending real runtime evidence.

Alpha.27 recovers bounded multi-record uncommitted audit suffixes atomically.
Upgrade all processes reading the same chain before enabling batched writes;
older readers cannot recover a multi-record suffix left by an interrupted batch.

Alpha.28 enables bounded coalescing of concurrent chained audit writes by default.
Set batchSize: 1 to retain singleton groups. Existing write/writeConfirmed/flush
signatures and chain schema/hash format are unchanged. A failed group may have a
durable prefix; all callers reject and no automatic retry occurs. See audit-chain.md.

Alpha.29 bounds best-effort blocking audit waits to 1,000 ms when auditTimeoutMs
is omitted. Previously that combination could wait forever. Set an explicit finite
limit for slower sinks. Candidate results remain unchanged under bestEffort;
returnDefault keeps its existing 1,000 ms deadline and default-on-failure policy.
Timeout does not cancel or retry storage; pending writes settle and count later.

Alpha.30 preserves simultaneous audit operation/cleanup failures as AggregateError
with the original cause, including initialization/close/owned-marker and metadata
publication/temporary-file failures. Callers inspecting raw plain-sink failures
should inspect cause/errors when multiple failures occur; single errors retain
identity. Optional chained sink onError receives raw trusted operator diagnostics;
public chained errors remain sanitized. Callback errors never replace storage
results and callbacks are not awaited. No automatic append or cleanup retry is added.

Alpha.31 prevents immediately resolved S3 byte iterators (including empty chunks)
from starving deadline and cancellation callbacks. No API or retry-policy change.

Alpha.32 makes large-record audit file framing linear in input bytes. Public
signatures, chain hashes and strict encoding/size/partial-record checks are unchanged.

Alpha.33 preserves compound snapshot recovery store failures in existing trusted
refresher onFailure diagnostics. Primary and cleanup failures remain ordered/nested
in AggregateError, while public load/commit/refresh errors remain sanitized. Handles
close once; owned cleanup is attempted even after close errors, without new retries.
Foreign or unverified lock identities remain untouched. Existing API and journal
format are unchanged; see snapshot-recovery.md for ambiguous accepted commits.
