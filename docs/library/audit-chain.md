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

`createChainedFileAuditSink({ directory, chainId, initialCheckpoint?,
maxSegmentBytes?, maxSegments?, maxRecordBytes?, maxVerificationBytes?,
maxQueueSize?, lockTimeoutMs? })` implements AuditSink including confirmed writes,
flush and queue stats. The plain file sink remains compatible. The chained sink
uses a dedicated directory, stable `segment-<first-sequence>.jsonl` names and an
atomically replaced `manifest.json`; these files must not be shared with plain
writers. A missing manifest in a nonempty directory fails closed, preventing a
lost manifest from silently resetting the chain. An optional trusted initial
checkpoint continues an externally anchored chain in a new empty directory.

Defaults: 10 MiB target segment size, 5 retained segments, 1 MiB record cap,
256 MiB verification budget, 5,000 queued writes and 5-second lock timeout.
Segment target accepts 1 byte..100 MiB, count 1..128, record cap up to 16 MiB and
verification budget up to 1 GiB. The budget must cover configured retained capacity.
An individual record remains whole even when larger than the segment target.
Queue overflow rejects; null is an explicit unbounded queue opt-in. `lock: false`,
automatic stale takeover and dropNewest are rejected even through untyped options.

Sequence/hash assignment, append/recovery and manifest changes happen inside the
shared package path queue and mandatory advisory owner lock. Independent cooperating
processes reread the manifest under that lock. Parent directories are trusted;
new directories/files use POSIX 0700/0600. Existing ownership, regular-file type,
no-follow identity and single-link checks protect managed files. Windows directory
ACLs and power-loss behavior remain caller/filesystem responsibilities.

A write flushes record data before atomically replacing/flushing metadata; POSIX
also syncs the directory. Rotation commits the new retained-file manifest before
unlinking pruned segments. Acknowledgment therefore defines durable acceptance,
subject to filesystem/storage guarantees. An error after metadata commit can still
mean the record was accepted. It cannot safely be undone by retrying an older head.
Append checks retained file sizes and the current committed tip; `getCheckpoint()`
drains writes, fully re-verifies retained records under the lock and returns frozen
`{ start, head, files }`, with safe relative filenames in oldest-first order.

A complete unacknowledged append or next-sequence rotation orphan is re-verified,
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
