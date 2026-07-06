# Audit Event v1

Status: Draft
Repository Type: library

## Purpose

Audit event v1 records enough local evidence to explain flag evaluation without leaking
raw user context by default.

## Contract

- Audit events are JSON Lines records.
- Audit output is redacted by default.
- Raw targeting keys, emails, user IDs, IP addresses, tokens, passwords, authorization claims, and tenant identifiers must not be written by default.
- Evaluated flag values are excluded by default, especially object values.
- Cross-event correlation requires an explicit opt-in design such as keyed HMAC, not plain hashing of personal identifiers.
- Audit sink failures must not silently change the evaluated flag value.

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

## Review Blockers

- Audit events include raw context or evaluated object values by default.
- Redaction mode changes without compatibility and security review.
- Audit event fields are removed without semver notes.
