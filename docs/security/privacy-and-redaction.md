# Privacy and Redaction

Status: Draft
Owner: 0disoft

## Purpose

Evaluation context is sensitive by default. Users may pass emails, user IDs, tenant IDs,
authorization claims, IP addresses, and tokens into flag evaluation context.

## Policy

- Raw evaluation context is not logged by default.
- Targeting key presence may be recorded, but the raw value is not.
- Context key names are replaced with a count by default. A caller may explicitly opt
  into names for fixed schema-like keys or omit both names and count.
- Evaluated flag values are not written to audit output by default.
- Object flag values are treated as sensitive by default.
- Correlation across events requires explicit opt-in and a keyed design.

## Implemented Controls

- Audit context stores targeting-key presence and the applied key-disclosure mode.
- `contextKeys: "names"` stores sorted names, `"count"` stores only their count, and
  `"none"` stores neither names nor count. These modes never read property values, but
  `names` is safe only for fixed schema-like keys: applications that encode emails,
  tokens, or other data in property names must use `count` or `none`.
- Redaction sorts keys only in `names` mode. `count` counts own enumerable keys
  without sorting; `none` skips key enumeration entirely and reads only the own
  data descriptor needed for targeting-key presence. Serialized fields are unchanged.
- Omitting `contextKeys` selects `count`; key-name disclosure always requires an explicit
  `names` choice.
- Snapshot and override data are represented by SHA-256 hashes.
- Evaluated values are excluded from audit events.
- V2 rule IDs are included only for selected targeting rules; flag names, rule IDs,
  variant names and caller metadata must be non-sensitive. Explanations omit values,
  context fields and condition operands, but match outcomes can still reveal cohort
  membership. Simulation/comparison counts can disclose small groups; protect reports.
- Conditions read only bounded own data-property paths, not getters or prototypes.
  Audit redaction and direct provider targeting-key extraction do not invoke getters.
  Proxy traps and SDK-owned context merging remain caller-controlled behavior.
- Snapshot/override hashes identify inputs; hashing low-entropy configuration does not
  make it confidential and does not authenticate its author. Replay still requires
  the original sanitized inputs; audit records alone do not retain those inputs.
- JSON Lines serialization is explicit.
- File audit sinks append only serialized redacted events.
- Provider audit sink failures are logged without changing the evaluated result
  by default. Opt-in `returnDefault` emits generic failure details without the
  sink exception or selected candidate metadata; see the audit failure contract.
- Provider warnings include the original error object for operator diagnosis. Logger
  destinations must remain operator-controlled because filesystem errors may include
  trusted local paths.
- Optional metrics project only bounded type/reason/source/error categories and
  duration plus aggregate operational counts. User context, flag keys, variants,
  hashes and exception messages are excluded. Caller-owned telemetry resource
  metadata and exporters remain outside this projection.

Optional snapshot refresher `onFailure` is an explicit trusted operator boundary:
it receives original causes, which may include source URLs, SDK response details,
filesystem paths or credentials. Redact before forwarding to logging/telemetry.
Causes are retained privately for this callback, never attached to public package
errors, operational status or audit records. No automatic logging is added.

## Review Blockers

- Examples log raw context values.
- Audit defaults expose targeting keys or evaluated object values.
- Redaction opt-out is implicit or enabled by convenience defaults.
- A strict key-disclosure mode leaks a context key name or raw value.
- Documentation presents dynamic context key names as non-sensitive data.
