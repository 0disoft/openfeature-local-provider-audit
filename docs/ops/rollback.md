# Rollback

Status: Draft

## Operational Contract

Rollback means package pinning, patch release, reverting compatibility-sensitive changes,
or documenting migration steps. There is no hosted deployment rollback in the MVP.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: a breaking behavior lacks rollback, migration, or semver treatment.
- Remaining operational risk: callers must pin or downgrade packages in their own dependency managers.
