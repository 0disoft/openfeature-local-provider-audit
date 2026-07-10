# ADR 0009: Audit Context Key Redaction

Status: Accepted
Owner: 0disoft

## Purpose

Allow consumers to reduce metadata disclosure from audit context key names without
weakening the existing raw-value redaction guarantee or changing the default key-name
policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Library contract: docs/library/audit-event-v1.md
- Security contract: docs/security/privacy-and-redaction.md
- Technical owner: 0disoft

## Decision

- Keep `contextKeys: "names"` as the default for compatibility.
- Add `"count"` to emit only the number of context keys.
- Add `"none"` to emit neither key names nor their count.
- Always emit `keyMode` and keep `keys` array-valued. Non-`names` modes use an empty
  array so existing consumers do not lose the field.
- Keep `targetingKeyPresent` as a boolean presence signal in every mode.
- Do not add a mode that emits raw context values.

## Compatibility

This is an additive public API and audit event change. Existing callers retain key-name
output by default. Consumers that validate audit events with a closed schema must allow
the new `keyMode` field and optional `keyCount` field before upgrading.
`RedactedAuditContext.keyMode` remains optional in the TypeScript type so callers can
still represent pre-0.13 events and existing manually constructed audit objects.

## Failure And Recovery

Unsupported modes fail during provider creation or direct redaction. A provider never
starts with an unknown audit policy. Consumers can recover by removing the option or
selecting `names`, `count`, or `none`.

## Validation

- Contract tests cover all three modes and reject unsupported values.
- Provider tests prove strict mode reaches sink events without key names or raw values.
- Package, documentation, and release readiness checks remain required by VALIDATION.md.

## Review Blockers

- A strict mode serializes a context key name or raw value.
- The default changes without semver and migration review.
- `keys` disappears instead of remaining an empty array in strict modes.
- Provider and direct-event APIs apply different redaction semantics.
