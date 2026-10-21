# Audit chain and trusted checkpoints

Status: primitives and verification in development; file-writer integration pending.

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

## Trust and remaining writer scope

Consecutive links detect modification, reorder, duplication and interior deletion
relative to the starting point. A trusted exact head detects tail loss/rewrite
inconsistent with that checkpoint, and rejects an extra tail. Use a closed copied
prefix when comparing an older checkpoint with an actively growing log.

An unanchored chain is not a signature, identity proof or proof against whole-file
rewrite/recomputation or tail truncation. Keep checkpoints outside the writable log
boundary, with independent access/authentication and durable retention. Another JSON
file beside the log does not create independent trust. External checkpoint delivery
and retention belong to the operator; no remote writer is installed here.

Plain `createFileAuditSink` output remains unchanged. These primitives do not yet
make it a chain writer. Next: assign links inside path/process locks, preserve
rotation continuity, anchor retained prefixes, reject incompatible modes and define
checkpoint/write durability. Partial append/crash, lock takeover, shared writers and
retention deletion require explicit handling. Then audit the whole P2 acceptance.
