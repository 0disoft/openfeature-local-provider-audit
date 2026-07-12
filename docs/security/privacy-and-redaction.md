# Privacy and Redaction

Status: Draft
Owner: 0disoft

## Purpose

Evaluation context is sensitive by default. Users may pass emails, user IDs, tenant IDs,
authorization claims, IP addresses, and tokens into flag evaluation context.

## Policy

- Raw evaluation context is not logged by default.
- Targeting key presence may be recorded, but the raw value is not.
- Context key names may be recorded under the default `names` policy, or replaced with a
  count or omitted when the caller selects a stricter policy.
- Evaluated flag values are not written to audit output by default.
- Object flag values are treated as sensitive by default.
- Correlation across events requires explicit opt-in and a keyed design.

## Implemented Controls

- Audit context stores targeting-key presence and the applied key-disclosure mode.
- `contextKeys: "names"` stores sorted names, `"count"` stores only their count, and
  `"none"` stores neither names nor count. These modes never read property values, but
  `names` is safe only for fixed schema-like keys: applications that encode emails,
  tokens, or other data in property names must use `count` or `none`.
- Snapshot and override data are represented by SHA-256 hashes.
- Evaluated values are excluded from audit events.
- JSON Lines serialization is explicit.
- File audit sinks append only serialized redacted events.
- Provider audit sink failures are logged without changing the evaluated result.
- Provider warnings include the original error object for operator diagnosis. Logger
  destinations must remain operator-controlled because filesystem errors may include
  trusted local paths.

## Review Blockers

- Examples log raw context values.
- Audit defaults expose targeting keys or evaluated object values.
- Redaction opt-out is implicit or enabled by convenience defaults.
- A strict key-disclosure mode leaks a context key name or raw value.
- Documentation presents dynamic context key names as non-sensitive data.
