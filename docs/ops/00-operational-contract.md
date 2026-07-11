# Operational Contract

Status: Draft

## Operational Contract

Operational scope is package maintenance, CI evidence, release safety, and local artifact
guidance. There is no hosted runtime, SLO, RTO, RPO, or on-call service in the MVP.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: failing docs/check/test evidence for public provider behavior.
- Remaining operational risk: native file-event delivery varies across mounted and network
  filesystems. Consumers must use a concrete local file or an explicit reload signal when their
  deployment volume does not emit events for the watched path.
