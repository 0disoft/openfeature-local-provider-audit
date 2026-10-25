# Audit Event v1

Status: Implemented alpha
Repository Type: library

## Purpose

Audit event v1 records enough local evidence to explain flag evaluation without leaking
raw user context by default.

## Contract

- Audit events are JSON Lines records.
- Audit output is redacted by default through `createAuditEvent` and `serializeAuditEvent`.
- Local file sink output uses the same JSON Lines serialization.
- Raw targeting keys, emails, user IDs, IP addresses, tokens, passwords, authorization claims, and tenant identifiers must not be written by default.
- Evaluated flag values are excluded by default, especially object values.
- Default events do not correlate subjects. Optional keyed HMAC correlation is defined in `audit-pseudonyms.md`; it never uses plain identifier hashing.
- Audit sink failures do not change the evaluated flag value by default.
  The 2.0 prerelease adds an explicit opt-in failure response; see
  `audit-failure-policy.md` for confirmation, timeout and candidate-record semantics.

## Event Fields

- `schemaVersion`
- `eventId`
- `timestamp`
- `providerName`
- `flagKey`
- `requestedType`
- `reason`
- `source`
- `variant`
- `ruleId` (optional, selected schema v2 targeting rule; non-sensitive IDs only)
- `errorCode`
- `snapshotHash`
- `provenance` (optional exact signed-artifact metadata in the 2.0 prerelease)
- `overrideHash`
- `context`

## Implemented Behavior

- `snapshotHash` is SHA-256 over stable JSON for the local snapshot.
- Optional `provenance` captures the evaluation-time signed artifact hash, snapshot
  hash, sequence, key ID, audience and issuance/expiry. Only documented metadata
  fields are copied and frozen; raw keys, context and artifacts are excluded.
  Unsigned provider updates clear it even when the snapshot hash is unchanged.
  Direct caller metadata is not signature proof; see `signed-snapshots.md`.
- `overrideHash` is SHA-256 over stable JSON for explicit override input when provided.
- Stable JSON orders object keys with locale-independent code unit comparison.
- Provider-created audit events use hashes cached on provider state so evaluation does
  not re-hash the full snapshot for every audit write.
- `context` always records `targetingKeyPresent`, the applied `keyMode`, an array-valued
  `keys` field, and `redacted: true`.
- Context key disclosure defaults to `count`, which empties `keys` and adds `keyCount`.
  The `names` mode explicitly opts into sorted key names; the `none` mode empties
  `keys` and omits the count.
- `createAuditEvent({ redaction })`, `redactContext(context, options)`, and
  `createLocalProvider({ auditRedaction })` accept the same context-key policy.
- Raw context values and evaluated flag values are not serialized.
- `serializeAuditEvent(event)` returns one JSON record followed by `\n`.
- Pre-0.13 and manually constructed contexts may omit `keyMode` and retain key names
  per ADR 0009. Serialization, file sinks and chain verification preserve these fields
  without inserting a mode. Explicit `count` and `none` still require empty `keys`.
- Serialization and ordinary file sinks validate the documented event/context
  fields and reject unknown fields, accessors and custom toJSON methods without
  invoking them. File sink write/writeConfirmed copy and freeze the event before
  enqueue, so later caller mutations cannot alter the record. Records are capped
  at 16 MiB (including the newline); context names are limited to 10,000 entries.
- `createFileAuditSink(options)` appends JSON Lines records to a caller-provided path.
- File audit sink paths are trusted local configuration. Do not pass tenant, end-user,
  request, or unvalidated environment input directly into `path`.
- File audit sinks expose optional `flush()` to wait for pending non-blocking writes.
  `flush()` drains all pending writes and reports previously settled failures that have
  not yet been reported by an earlier flush. Each settled failure is consumed by one
  serialized flush call. Failure count is exact; retained error objects are capped at 16
  per flush interval so an undrained failure ledger cannot grow without bound.
- File audit sinks expose optional `getStats()` with pending, dropped, and rejected write
  counters plus the effective count and byte limits. Optional `pendingBytes` and
  `maxQueueBytes` expose pending event JSON Lines bytes and their budget. Counters are cumulative for the sink lifetime.
- File audit sinks support size-based rotation with `maxBytes` and retained rotated
  file count with `maxFiles`.
- New POSIX audit directories and files use `0700` and `0600`. The final path rejects
  symbolic links, non-regular files, foreign ownership on POSIX, and multiple hard links.
  Existing non-regular paths are rejected before rotation/open. Where supported,
  nonblocking open also prevents a concurrent FIFO replacement from hanging the queue;
  the opened handle is still checked before writing.
- With no rotation (`maxBytes`) and no lock configured, the plain file sink groups
  already waiting records into at most 64 records / 64 KiB of UTF-8 JSON Lines per
  append. There is no batching timer or delay added to wait for future records.
  A larger admitted record is an isolated singleton under the existing 16 MiB
  per-record limit. FIFO and per-record queue count/byte reservations remain.
  Rotation or locking keeps the original per-record write path; their boundaries,
  lock acquisition and timeout meanings do not change. Batch grouping does not
  establish ordering across independent sinks/processes or filesystem durability.
  Confirmation resolves only after the shared append and handle close complete.
  A shared storage failure rejects each affected record, without automatic retry;
  partial/ambiguous writes remain possible. Flush reports failures per record,
  not per append, through the existing bounded failure ledger. No fsync is added.
- Sinks from one loaded package instance serialize writes by audit path, including
  rotation. Cross-process and duplicate-package-instance writers remain caller-owned
  coordination and require `lock: true` when sharing a rotating path.
- On Windows, process-queue keys are lowercased so ordinary letter-case aliases
  share rotation/append ownership. Actual I/O paths are preserved. This may also
  serialize distinct names in case-sensitive Windows directories; POSIX keys keep
  their case. Key normalization costs O(L) for L path characters and adds no I/O.
  This is not filesystem identity resolution: junctions, short names or other
  aliases still require consistent paths and cooperating locks. It does not add
  cross-process or duplicate-package-instance coordination.
- File audit sinks capture an absolute path at construction. Later caller URL or
  working-directory changes cannot redirect writes, rotation or locking independently.
- File audit sinks support optional advisory `.lock` files with `lock` and
  `lockTimeoutMs`. Lock wait deadlines use monotonic elapsed time.
  `staleLockMs` is deprecated and supplying it throws: time-based takeover cannot
  safely exclude live writers or conditionally remove only an inspected owner.
- Each acquired lock captures its handle's device/inode identity before writing
  an owner token. Normal release checks the current regular file identity and token.
  If initialization fails (including a partial token written before ENOSPC), cleanup
  removes the same acquired file regardless of the incomplete record contents.
  Empty/different-file replacements and copied tokens on another file are preserved.
  If handle identity could not be read, preserve the marker for operator recovery.
  Release attempts marker cleanup even after a handle-close error; compound failures
  remain observable. No failed initialization or audit write is automatically retried.
  Identity checks add one handle stat and one pathname lstat per acquired/released lock;
  they are not atomic conditional unlink, filesystem fencing or stale-lock takeover.
  Keep the directory trusted and stop writers before manually changing lock markers.
- File audit sinks bound their in-memory write queue to 5,000 writes by default.
  `maxQueueSize` accepts a positive caller-owned limit, while `null` explicitly selects
  unbounded count behavior. `maxQueueBytes` independently defaults to 64 MiB and
  accepts a positive safe integer or null to disable the byte bound. Both active
  and waiting writes reserve their captured JSON UTF-8 size plus one newline;
  reservations release on actual completion or failure, not on caller timeout.
  This is a payload budget, not a heap/RSS bound: JS objects, Promise overhead,
  temporary serialization and chain envelope bytes are additional. Budgets belong
  to each sink, not the entire process. Fully unbounded behavior requires both
  limits to be null. Invalid events are still validated before enqueue.
  `queueOverflowPolicy: "reject"` rejects the newest write when full, while
  `"dropNewest"` resolves without writing the newest event. Reject and drop outcomes
  increment separate counters.
- `createLocalProvider({ auditSink })` schedules audit writes after evaluation and logs
  sink failures without changing the returned resolution.
- Provider audit writes are non-blocking by default. Use
  `createLocalProvider({ auditWriteMode: "blocking" })` when a test or short-lived script
  must wait for each sink write before resolution, or call `auditSink.flush?.()` before
  process exit to drain pending non-blocking writes.
- The provider `onClose` hook releases events/metrics then flushes with a 5,000 ms
  default deadline (`auditShutdownTimeoutMs` overrides it). Timeout rejects without
  cancelling I/O. It does not close or claim
  exclusive ownership of a sink that may be shared by multiple providers.
- Rotation is local-file only. Cross-process coordination requires `lock: true` and
  cooperating writers that use the same advisory lock.
- Advisory locking coordinates cooperating processes on a trusted local filesystem.
  It is not a distributed lock or fencing mechanism. Stop all writers and confirm
  ownership before manually recovering an abandoned marker. No automatic stale takeover.

## Review Blockers

- Audit events include raw context or evaluated object values by default.
- Redaction mode changes without compatibility and security review.
- A non-`names` redaction mode serializes a context key name.
- Audit event fields are removed without semver notes.
- Audit file rotation deletes or rewrites caller-provided paths outside the audit file
  family.
- Audit sink paths are documented as safe for untrusted user input.
- Multi-process examples share an audit file without advisory locking.
- Queue overflow behavior changes without tests for both reject and drop-newest modes.
- Snapshot or override hash ordering depends on host locale.

Audit operations retain both primary and cleanup failures rather than allowing a
finally failure to replace the original. A lone failure keeps its original identity;
a simultaneous failure becomes AggregateError with the primary cause first. Lock
initialization attempts both close and owned-marker removal even if they fail, and
initialization errors are never retried as contention. Neither append nor cleanup
is automatically retried. Foreign lock markers remain untouched.

## Immutable snapshot hash reuse

The shared snapshot-hash path used by explanations and audit-event creation reuses
a hash only for a captured, deeply frozen snapshot registered by this module
instance's validator. Merely freezing a caller object is not sufficient: nested
values or accessor results may change. Such inputs always use the original hash
calculation. Independent parses have independent identities; hashes and evaluation
results retain their existing semantics. Another loaded package copy/entry can
fall back to recalculation rather than assuming shared ownership.

A WeakSet tracks validated ownership and a WeakMap stores only the 64-character
SHA-256 result per live snapshot. Neither retains discarded snapshots. No canonical
JSON payload or evaluation result is cached. Overrides still recompute from their
current contents. For R static explanations of an unchanged snapshot containing
F fixed-size flag definitions and S serialized bytes, canonicalization/hashing work changes from
O(R * (F log F + S)) to O(F log F + S + R), excluding request-specific evaluation.

Run `pnpm benchmark:explanation` for a fixed local workload (1/1,000 flags, 200
explanations, five warm timing samples). It also counts full-root canonicalizations
across a separate cold sequence and checks every explanation against the uncached
raw-input result. Timings exclude parsing, disk and network; they do not measure
whole-server throughput or the provider path that already supplied cached hashes.
