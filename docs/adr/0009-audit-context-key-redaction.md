# ADR 0009: Audit Context Key Redaction

Status: Accepted
Owner: 0disoft

## Purpose

Allow consumers to control metadata disclosure from audit context key names without
weakening the raw-value redaction guarantee.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Library contract: docs/library/audit-event-v1.md
- Security contract: docs/security/privacy-and-redaction.md
- Technical owner: 0disoft

## Decision

- Use `contextKeys: "count"` as the default from `0.14.0` so dynamic property names do
  not leak personal or secret data by default.
- Keep `"names"` as an explicit opt-in for fixed schema-like context keys.
- Add `"count"` to emit only the number of context keys.
- Add `"none"` to emit neither key names nor their count.
- Always emit `keyMode` and keep `keys` array-valued. Non-`names` modes use an empty
  array so existing consumers do not lose the field.
- Keep `targetingKeyPresent` as a boolean presence signal in every mode.
- Do not add a mode that emits raw context values.

## Compatibility

The modes and event fields were additive in `0.13.0`; changing the default to `count` in
`0.14.0` is compatibility-sensitive. Consumers that need prior key-name output must set
`auditRedaction.contextKeys: "names"` before upgrading. Consumers that validate audit
events with a closed schema must accept `keyMode: "count"`, an empty `keys` array, and
`keyCount`.
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
