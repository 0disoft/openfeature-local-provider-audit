# Release

Status: Draft

## Operational Contract

Release readiness depends on public API docs, compatibility notes, semver review,
package checks, replay fixture evidence, and redaction tests once implementation exists.

## Implemented Alpha Workflow

- GitHub Actions workflow: `.github/workflows/release.yml`.
- Trigger: pushed tags matching `v*`.
- Tag gate: the tag must match `v${packages/local-provider/package.json.version}`.
- Validation: runs the repository `check` command and the Node basic example smoke.
- Artifact: packs `@0disoft/openfeature-local-provider` and uploads the `.tgz` as a
  GitHub Actions artifact.
- Publishing: npm publish is intentionally not performed until npm trusted publishing is
  configured for this repository and workflow.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: changed public behavior without matching docs and validation.
- Remaining operational risk: release artifacts are verified and retained by GitHub
  Actions, but public npm publishing still requires trusted publisher setup.
