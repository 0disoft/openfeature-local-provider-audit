# Incident Response

Status: Draft

## Operational Contract

Incident response is maintainer response to package regressions, not hosted-service
operations. The most likely incidents are bad bucketing, privacy leaks in audit logs,
and broken flag parsing.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: known regression in bucketing, redaction, or default behavior.
- Remaining operational risk: no live service rollback exists; recovery is package pinning, patch release, and migration notes.
