# Release

Status: Draft

## Operational Contract

Release readiness depends on public API docs, compatibility notes, semver review,
package checks, replay fixture evidence, and redaction tests once implementation exists.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: changed public behavior without matching docs and validation.
- Remaining operational risk: no package can be released safely until runtime targets and exports are implemented and tested.
