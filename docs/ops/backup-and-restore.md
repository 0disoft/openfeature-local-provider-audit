# Backup and Restore

Status: Draft

## Operational Contract

The package owns no hosted data store. Backup and restore guidance applies to
caller-owned flag files, audit logs, and replay fixtures.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: examples imply this package backs up caller data.
- Remaining operational risk: callers must own retention and restoration of local audit artifacts.
