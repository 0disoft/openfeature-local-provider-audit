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
- Cross-event correlation requires an explicit future opt-in design such as keyed HMAC, not plain hashing of personal identifiers.
- Audit sink failures must not change the evaluated flag value.

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
- `errorCode`
- `snapshotHash`
- `overrideHash`
- `context`

## Implemented Behavior

- `snapshotHash` is SHA-256 over stable JSON for the local snapshot.
- `overrideHash` is SHA-256 over stable JSON for explicit override input when provided.
- Stable JSON orders object keys with locale-independent code unit comparison.
- Provider-created audit events use hashes cached on provider state so evaluation does
  not re-hash the full snapshot for every audit write.
- `context` always records `targetingKeyPresent`, the applied `keyMode`, an array-valued
  `keys` field, and `redacted: true`.
- Context key disclosure defaults to `names`, which preserves sorted key names. The
  `count` mode empties `keys` and adds `keyCount`; the `none` mode empties `keys` and
  omits the count.
- `createAuditEvent({ redaction })`, `redactContext(context, options)`, and
  `createLocalProvider({ auditRedaction })` accept the same context-key policy.
- Raw context values and evaluated flag values are not serialized.
- `serializeAuditEvent(event)` returns one JSON record followed by `\n`.
- `createFileAuditSink(options)` appends JSON Lines records to a caller-provided path.
- File audit sink paths are trusted local configuration. Do not pass tenant, end-user,
  request, or unvalidated environment input directly into `path`.
- File audit sinks expose optional `flush()` to wait for pending non-blocking writes.
  `flush()` drains all pending writes and reports previously settled failures that have
  not yet been reported by an earlier flush. Each settled failure is consumed by one
  serialized flush call. Failure count is exact; retained error objects are capped at 16
  per flush interval so an undrained failure ledger cannot grow without bound.
- File audit sinks expose optional `getStats()` with pending and dropped write counters.
- File audit sinks support size-based rotation with `maxBytes` and retained rotated
  file count with `maxFiles`.
- New POSIX audit directories and files use `0700` and `0600`. The final path rejects
  symbolic links, non-regular files, foreign ownership on POSIX, and multiple hard links.
- Sinks from one loaded package instance serialize writes by audit path, including
  rotation. Cross-process and duplicate-package-instance writers remain caller-owned
  coordination and require `lock: true` when sharing a rotating path.
- File audit sinks support optional advisory `.lock` files with `lock`, `lockTimeoutMs`,
  and `staleLockMs` for multi-process local writers.
- Each acquired lock records an owner token. A releasing writer removes the lock only
  when that token still matches, so a stale owner cannot delete a replacement owner's
  lock after takeover.
- File audit sinks may bound their in-memory write queue with `maxQueueSize`.
  `queueOverflowPolicy: "reject"` rejects the newest write when full, while
  `"dropNewest"` resolves without writing the newest event and increments the dropped
  write counter.
- `createLocalProvider({ auditSink })` schedules audit writes after evaluation and logs
  sink failures without changing the returned resolution.
- Provider audit writes are non-blocking by default. Use
  `createLocalProvider({ auditWriteMode: "blocking" })` when a test or short-lived script
  must wait for each sink write before resolution, or call `auditSink.flush?.()` before
  process exit to drain pending non-blocking writes.
- The provider `onClose` hook flushes its configured sink. It does not close or claim
  exclusive ownership of a sink that may be shared by multiple providers.
- Rotation is local-file only. Cross-process coordination requires `lock: true` and
  cooperating writers that use the same advisory lock.
- Advisory locking is best-effort coordination for cooperating processes on a local
  filesystem. It is not a distributed lock or a fencing mechanism; an aggressive
  `staleLockMs` can still classify a live writer as stale.

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
