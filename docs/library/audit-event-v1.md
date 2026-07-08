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
- Provider-created audit events use hashes cached on provider state so evaluation does
  not re-hash the full snapshot for every audit write.
- `context` records only `targetingKeyPresent`, sorted context key names, and `redacted: true`.
- Raw context values and evaluated flag values are not serialized.
- `serializeAuditEvent(event)` returns one JSON record followed by `\n`.
- `createFileAuditSink(options)` appends JSON Lines records to a caller-provided path.
- File audit sink paths are trusted local configuration. Do not pass tenant, end-user,
  request, or unvalidated environment input directly into `path`.
- File audit sinks expose optional `flush()` to wait for pending non-blocking writes.
- File audit sinks support size-based rotation with `maxBytes` and retained rotated
  file count with `maxFiles`.
- File audit sinks support optional advisory `.lock` files with `lock`, `lockTimeoutMs`,
  and `staleLockMs` for multi-process local writers.
- `createLocalProvider({ auditSink })` schedules audit writes after evaluation and logs
  sink failures without changing the returned resolution.
- Provider audit writes are non-blocking by default. Use
  `createLocalProvider({ auditWriteMode: "blocking" })` when a test or short-lived script
  must wait for each sink write before resolution, or call `auditSink.flush?.()` before
  process exit to drain pending non-blocking writes.
- Rotation is local-file only. Cross-process coordination requires `lock: true` and
  cooperating writers that use the same advisory lock.

## Review Blockers

- Audit events include raw context or evaluated object values by default.
- Redaction mode changes without compatibility and security review.
- Audit event fields are removed without semver notes.
- Audit file rotation deletes or rewrites caller-provided paths outside the audit file
  family.
- Audit sink paths are documented as safe for untrusted user input.
- Multi-process examples share an audit file without advisory locking.
