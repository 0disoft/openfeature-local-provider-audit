# Audit chain and trusted checkpoints

Status: primitives/verification alpha.13; segmented file writer alpha.14, locally implemented.

An opt-in chain wraps a redacted AuditEvent v1:
`{ schemaVersion: 1, chainId, sequence, previousHash, event, hash }`.
Chain IDs accept 1..128 non-personal ASCII letters/digits/dot/underscore/colon/slash/
hyphen. Sequence is a positive safe integer. Checkpoints are
`{ schemaVersion: 1, chainId, sequence, hash }`; zero denotes genesis.

`createAuditChainCheckpoint(chainId)` constructs genesis. `createChainedAuditEvent`
captures/freezes documented event fields and appends to an explicit checkpoint.
`verifyAuditChainRecord` checks one consecutive record and returns its checkpoint.
`verifyAuditChain` checks an iterable from explicit `start`, optionally requiring
exact `expectedHead`, returning `{ records, head, checkpointMatched }`.
A supplied checkpoint is a caller trust assertion, not independent authenticity.
Checkpoint matching is false when no expected head was required.

Checkpoint capture validates own data fields, schema, chain ID, safe sequence and
hash syntax on every call. Only sequence zero recomputes and compares the genesis
digest. Positive checkpoints proceed to record hashing without computing an unused
genesis digest or constructing its checkpoint object. Record linkage, canonical
bytes and the explicit caller trust assertion retain their existing contracts.

## Bytes and schema

Alpha.16 also captures optional `event.schedule` under `scheduled-rollout.md`;
evaluatedAt, stage and percentage are strictly captured and included in the hash.
Schedule-free records retain their canonical bytes. Opt-in writers/verifiers must
upgrade together because older verifiers reject unknown fields.

Alpha.15 optionally captures `event.pseudonym` under `audit-pseudonyms.md`. All four
fields are frozen and hash-covered. Old records without it retain their canonical
bytes. Older alpha verifiers reject the new field; upgrade alongside opt-in writers.

Genesis is lowercase hex SHA-256 over UTF-8
`"openfeature-local-audit-genesis/v1\u0000" + chainId`.
Record hash is SHA-256 over UTF-8
`"openfeature-local-audit-record/v1\u0000" + stableJson(body)`.
Body contains exactly schemaVersion, chainId, sequence, previousHash and event.
Stable JSON orders object keys by UTF-16 code units, retains array order and uses
JSON string/number encoding, as with snapshot hashes. Whitespace and original
member order are not authenticated byte differences. JSON duplicate members follow
ECMAScript last-member parsing; discarded earlier members are not authenticated.
Generated records contain unique members. This is semantic canonical verification,
not an authenticity claim for every original input byte.

Unknown fields, accessors, invalid enums/hash/sequence and raw evaluation/context
fields are rejected. Context follows explicit redaction modes; names are an opt-in
disclosure. Signed provenance must match the event snapshot hash. Inputs are copied
and frozen without invoking getters/toJSON. Canonical record limit defaults to
1 MiB (1 byte..16 MiB configurable), with at most 10,000 context key names.
Iterable verification defaults to 100,000 records (0..10,000,000 configurable).

Iterable verification captures the caller's start and optional expected checkpoint
before consuming records. The internal loop reuses only its own verified frozen
checkpoints and the already validated byte limit, avoiding one checkpoint capture
per record. Every record still receives structural, event, sequence, size and hash
validation. Standalone record verification always captures the caller's checkpoint.

Record size reuses the canonical body JSON produced for hashing after strict
capture. Adding the required `hash` member contributes exactly 74 UTF-8 bytes:
the comma, encoded key/value delimiters and 64 unescaped SHA-256 hex characters.
Member ordering cannot change this length. Creation and verification therefore
canonicalize and serialize the captured graph once, rather than repeating it only
to count bytes. Escapes, Unicode and the inclusive byte limit retain their semantics;
the terminal JSONL newline is outside the record cap. This avoids a graph copy and
serialization, not the O(N) work required to serialize and hash a record of size N.

Creation checks this canonical UTF-8 size before constructing the domain-separated
record hash input or computing its digest, as verification already does. JSON escapes
and multibyte strings can exceed the byte cap despite passing the earlier character
budget. Such records skip the record digest and retain the generic `SCHEMA_ERROR`;
genesis checkpoint authentication still occurs first. Canonicalization is still
required to measure the bytes, and valid record hashes and inclusive limits are unchanged.

## Verify JSON Lines

`openfeature-local-provider audit-verify <oldest.jsonl> ... <current.jsonl>
--chain-id <id> [--expect-head <trusted.json>]` verifies from genesis.
For a retained suffix, use `--start <trusted-prefix-checkpoint.json>` instead of
`--chain-id`. The first record must be start.sequence + 1, linked to start.hash.
Do not derive a trusted anchor from an untrusted first retained record.

Files are UTF-8 JSON Lines, terminal newline, no blank lines, oldest first; CRLF
is accepted. Sequential regular-file/no-follow reads are bounded by 256 MiB total,
1 MiB per record, 100,000 records and 128 files. Options `--max-bytes`,
`--max-record-bytes`, `--max-records` select limits up to 1 GiB, 16 MiB and
10,000,000. Checkpoint files are at most 16 KiB. JSON summary output excludes raw
events, context and paths. Exit codes: 0 verified, 1 invalid/I/O/limit, 2 usage.
Errors are generic without offending fields or nested causes.

## Trust boundaries

Consecutive links detect modification, reorder, duplication and interior deletion
relative to the starting point. A trusted exact head detects tail loss/rewrite
inconsistent with that checkpoint, and rejects an extra tail. Use a closed copied
prefix when comparing an older checkpoint with an actively growing log.

An unanchored chain is not a signature, identity proof or proof against whole-file
rewrite/recomputation or tail truncation. Keep checkpoints outside the writable log
boundary, with independent access/authentication and durable retention. Another JSON
file beside the log does not create independent trust. External checkpoint delivery
and retention belong to the operator; no remote writer is installed here.

## Segmented chained file sink

Use the separate read-only `audit-diagnose <directory>` command for bounded,
redacted diagnosis without recovery or cleanup. See `audit-diagnosis.md`; a valid
observation is not an atomic copy or an authenticated checkpoint.

`createChainedFileAuditSink({ directory, chainId, initialCheckpoint?,
maxSegmentBytes?, maxSegments?, maxRecordBytes?, maxVerificationBytes?,
maxQueueSize?, maxQueueBytes?, batchSize?, maxBatchBytes?, lockTimeoutMs? })` implements AuditSink including confirmed writes,
flush and queue stats. The plain file sink remains compatible. The chained sink
uses a dedicated directory, stable `segment-<first-sequence>.jsonl` names and an
atomically replaced `manifest.json`; these files must not be shared with plain
writers. A missing manifest in a nonempty directory fails closed, preventing a
lost manifest from silently resetting the chain. An optional trusted initial
checkpoint continues an externally anchored chain in a new empty directory.

Defaults: 10 MiB target segment size, 5 retained segments, 1 MiB record cap,
256 MiB verification budget, 5,000 queued writes, 64 MiB queued event payload
and 5-second lock timeout.
Segment target accepts 1 byte..100 MiB, count 1..128, record cap up to 16 MiB and
verification budget up to 1 GiB. The budget must cover configured retained capacity.
An individual record remains whole even when larger than the segment target.
Queue overflow rejects on either count or bytes. `maxQueueBytes` accepts a positive
safe integer or null; a null limit disables only that bound. Pending bytes measure
captured event JSON in UTF-8 plus newline, excluding chain envelope and JS overhead.
Active writes retain their reservation until settlement. Both limits must be null
for a fully unbounded queue; see `audit-event-v1.md`. `lock: false`,
automatic stale takeover and dropNewest are rejected even through untyped options.

Sequence/hash assignment, append/recovery and manifest changes happen inside the
shared package path queue and mandatory advisory owner lock. Independent cooperating
processes reread the manifest under that lock. Parent directories are trusted;
new directories/files use POSIX 0700/0600. Existing ownership, regular-file type,
no-follow identity and single-link checks protect managed files. Writer opens and
streaming verification/recovery compare pathname and handle device/inode IDs from
`bigint` stats, so distinct 64-bit IDs cannot compare equal through number rounding.
A mismatch closes the handle before record reads or writes. Existing owner/link
checks and byte budgets remain active; no extra stat or open call is introduced.
These checks do not make pathname inspection and opening an atomic operation.
Windows directory
ACLs and power-loss behavior remain caller/filesystem responsibilities.

A write flushes record data before atomically replacing/flushing metadata; POSIX
also syncs the directory. Rotation commits the new retained-file manifest before
unlinking pruned segments. Acknowledgment therefore defines durable acceptance,
subject to filesystem/storage guarantees. An error after metadata commit can still
mean the record was accepted. It cannot safely be undone by retrying an older head.
Append checks sealed segment metadata with no-follow lstat: regular file, current
owner where supported, single link and exact committed size. These checks require
no open file descriptor. The active tip still uses no-follow open/descriptor identity
validation, tail hashing and bounded suffix recovery with finally-bound close. All
checks run under the same mandatory owner lock, without an in-memory file cache.
Tip discovery starts with at most 4 KiB and doubles its search window, bounded by
the committed size and the record limit plus terminal LF. Each expansion reads
only the previously unread prefix and retains fragments for this call, rather
than rereading the entire window. Fragments are assembled in file order once the
separator or limit is reached. Short reads still fill each requested range; tip
parsing/hash checks and full checkpoint verification are unchanged.
Append checks retained file sizes and the current committed tip; `getCheckpoint()`
drains writes, fully re-verifies retained records under the lock and returns frozen
`{ start, head, files }`, with safe relative filenames in oldest-first order.

A complete unacknowledged suffix or next-sequence rotation orphan is re-verified,
flushed and adopted on recovery before subsequent writes. Caller retries can thus
produce duplicate events at different sequence positions: this is not exactly-once
delivery. A partial/malformed tail, missing/truncated committed file or incompatible
manifest fails closed without deleting forensic data. An abandoned lock is never
automatically stolen: confirm its writer stopped before operator removal.

For unrecoverable partial data, stop writers, preserve the directory and verify a
closed copy through the last externally trusted checkpoint. Start a new dedicated
empty directory with that trusted checkpoint as `initialCheckpoint`; retain the
original evidence. Do not silently truncate bytes, delete a manifest or reset to
genesis. Retention cleanup uses the committed retained prefix under the same owner
lock. Recovery and subsequent writes retry deletion of canonical `segment-N.jsonl`
files whose starting sequence is after the initial checkpoint and at or before that
prefix. This recovers cleanup interrupted after metadata commit or by an unlink error.
A persistent deletion error rejects recovery before another append, preventing further
retention growth. Eligible files must still pass regular-file, owner and single-link
checks. Unrelated names, temporary files and future-sequence evidence are preserved;
remove other confirmed unreferenced artifacts only after stopping writers. Existing-
history backup restore still needs independent checkpoints.

Quiesce writers or make an external consistent copy before exporting files and
checkpoints, because later rotation can remove files after the lock is released.
Store checkpoint copies outside the log's writable trust boundary; the operational
manifest is not independent authentication. No remote checkpoint exporter is
installed. Requirement-by-requirement local evidence is recorded in
`../testing/p2-acceptance.md`.

Recovery validates the entire uncommitted suffix before publishing a new manifest.
It accepts at most 64 contiguous records and 4 MiB total encoded bytes (or one
record up to maxRecordBytes + 1 when larger). Missing newlines, invalid UTF-8,
invalid hashes, gaps and overflow preserve both the evidence and the committed
manifest. Recovery limits are shared with the batch writer, independent of its
local configuration. No valid prefix of a malformed suffix is adopted.

### Bounded durable batches

The chained sink coalesces already waiting requests in FIFO order, without a timer.
`batchSize` defaults to 64 (range 1..64); set it to 1 for singleton writes.
`maxBatchBytes` defaults to 1 MiB (range 1..4 MiB). Queue grouping counts captured
UTF-8 event JSON Lines bytes; storage splits again using actual encoded chain
record bytes and segment boundaries. A larger valid individual record is written
alone, up to maxRecordBytes + 1. Queue count/byte reservations remain held until
the actual group completes. The plain file sink retains singleton writes.

Each group rereads and recovers the manifest under the same process queue and
mandatory owner lock. Each chunk is appended and fsynced before the manifest is
atomically replaced and synced; the next segment is never written before that
commit. Confirmations resolve only after every chunk and retention cleanup succeed.
Batching reduces lock acquisition, metadata replacement and fsync calls; it adds no
network I/O, idle timer, concurrent file writes or cached cross-process manifest.

A group is not an atomic transaction across chunks. An error rejects every request
in that group, even when a committed prefix or a complete recoverable suffix exists.
No append is automatically retried. Later groups recover before proceeding; a
malformed/partial suffix blocks them and preserves evidence. Retrying a rejected
request manually may duplicate its event. Flush reports each failed request once,
with its existing bounded cause ledger. Mixed-version readers must all support
multi-record recovery before batch writes are enabled.

Local batch validation and workload limits are recorded in
`../testing/audit-batch-acceptance.md`.

### Enqueue-time event ownership

The chained file sink captures and deeply freezes each event synchronously before
enqueueing it. Its internal record builder reuses that owned capture under the same
record limit rather than copying it again. Public `createChainedAuditEvent` still
captures arbitrary input, including caller-frozen objects; stored records still
undergo complete verification. Canonical bytes, hashes, size limits and input
mutation isolation are unchanged. This removes one event/context/key-array capture
per queued event; canonicalization and storage work remain necessary.

### Operator-only storage diagnostics

Optional `onError(error)` receives the original storage/lock/recovery failure after
cleanup has been attempted. When both operation and cleanup fail, an AggregateError
retains the operation as `cause` and `errors[0]`, with the cleanup failure second.
Nested cleanup failures remain nested, preserving every original error and stage
message. One storage group reports once even if several grouped requests reject.
Queue overflow and invalid input rejected before storage do not invoke this hook.

This is a trusted operator interface: raw causes can contain private filesystem
paths or other sensitive details. Do not serialize them into public status, audit
events or SDK responses. Public chained sink rejections remain the generic
AUDIT_SINK_ERROR without raw cause. The callback is captured with its original
options receiver. It is not awaited; synchronous throws and asynchronous rejections
are observed and isolated, and a pending callback does not hold the storage queue.
Caller code must bound callback I/O and keep synchronous work short.

Audit verification scans each input byte once for line boundaries, retains bounded
byte fragments for an unfinished record, then decodes a complete line once. Large
records no longer repeatedly scan or re-encode an ever-growing string per read.

Short reads fill the unused tail of the current block instead of allocating a
new 64 KiB buffer for each result. Contiguous fragments in that backing store
merge into one zero-copy view. Full blocks are reused after complete lines, or
retained while an unfinished record needs them. With record wire bytes R and block
size B <= 64 KiB, input backing capacity is O(R + B) and fragment count is
O(ceil(R / B) + 1), independent of the number of short reads. Final line assembly
and decoded strings add memory; this is not a process-heap cap, and callers that
retain yielded strings own that additional memory.

Local Windows/Node 24 validation wrapped real file handles to limit each read to
one byte: a 1,024-byte line plus LF retained 67,174,400 input backing bytes before
and 65,536 after (1,025 blocks to one). Total input-buffer allocation including
the EOF read fell from 67,239,936 to 65,536 bytes. These are backing-buffer
measurements under injected short reads, not natural filesystem frequency, peak
RSS or production-latency claims. No additional payload-copy pass is introduced.
Exact byte budgets, strict UTF-8, CRLF, initial-file BOM handling, partial-tail
rejection and ordered verification retain their previous semantics.

Local performance evidence (2026-10-23, Windows, Node 24.14.0): three alternating
before/after runs reading two Unicode lines of 1, 4 and 8 MiB each, including output
SHA-256 checks, had median times of 39.8/19.6, 341.4/66.8 and 1242.8/118.4 ms.
All decoded counts and digests matched. These isolate file framing/decoding and
output comparison; they do not claim the same gain for full chain cryptographic
verification, small records, production storage or network filesystems.
