# Privacy and Redaction

Status: Draft
Owner: 0disoft

## Purpose

Evaluation context is sensitive by default. Users may pass emails, user IDs, tenant IDs,
authorization claims, IP addresses, and tokens into flag evaluation context.

## Policy

- Raw evaluation context is not logged by default.
- Targeting key presence may be recorded, but the raw value is not.
- Context key names may be recorded when they do not contain values.
- Evaluated flag values are not written to audit output by default.
- Object flag values are treated as sensitive by default.
- Correlation across events requires explicit opt-in and a keyed design.

## Review Blockers

- Examples log raw context values.
- Audit defaults expose targeting keys or evaluated object values.
- Redaction opt-out is implicit or enabled by convenience defaults.
