# Observability

Status: Draft

## Operational Contract

Observability means local audit and replay evidence. The package should not require a
metrics backend, tracing collector, dashboard, or remote logging service.

Provider warnings pass the original evaluation or audit-sink error as a structured logger
argument. Logger configuration owns formatting and destination policy; do not route these
warnings to an untrusted tenant-visible sink because filesystem errors may contain trusted
local paths.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: evaluation paths lack reason or audit evidence.
- Remaining operational risk: callers must choose where local JSON Lines audit output is stored.
