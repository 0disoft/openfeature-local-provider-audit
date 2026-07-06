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

## Implemented Alpha Behavior

- `snapshotHash` is SHA-256 over stable JSON for the local snapshot.
- `overrideHash` is SHA-256 over stable JSON for explicit override input when provided.
- `context` records only `targetingKeyPresent`, sorted context key names, and `redacted: true`.
- Raw context values and evaluated flag values are not serialized.
- `serializeAuditEvent(event)` returns one JSON record followed by `\n`.
- `createFileAuditSink(options)` appends JSON Lines records to a caller-provided path.
- `createLocalProvider({ auditSink })` schedules audit writes after evaluation and logs
  sink failures without changing the returned resolution.
- Provider audit writes are non-blocking by default. Use
  `createLocalProvider({ auditWriteMode: "blocking" })` when a test or short-lived script
  must wait for the sink write before resolution.
- Audit rotation and retention policy are not implemented in this slice.

## Review Blockers

- Audit events include raw context or evaluated object values by default.
- Redaction mode changes without compatibility and security review.
- Audit event fields are removed without semver notes.
