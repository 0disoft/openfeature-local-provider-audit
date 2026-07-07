# Release

Status: Draft

## Operational Contract

Release readiness depends on public API docs, compatibility notes, semver review,
package checks, replay fixture evidence, and redaction tests once implementation exists.

## Implemented Workflow

- GitHub Actions workflow: `.github/workflows/release.yml`.
- Trigger: pushed tags matching `v*`.
- Tag gate: the tag must match `v${packages/local-provider/package.json.version}`.
- Validation: runs the repository `check` command and the Node basic example smoke.
- Artifact: packs `@0disoft/openfeature-local-provider` and uploads the `.tgz` as a
  GitHub Actions artifact.
- Publishing: if the version is not already present on npm, the workflow publishes with
  npm trusted publishing and provenance.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: changed public behavior without matching docs and validation.
- Remaining operational risk: npm trusted publisher settings must continue to match
  `0disoft/openfeature-local-provider-audit` and `.github/workflows/release.yml`.
