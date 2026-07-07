# CI

Status: Draft

## Operational Contract

CI should prove docs, package checks, type safety, tests, replay fixtures, and hygiene once
a runner exists. Until then, final reports must be explicit about skipped executable checks.

## Implemented Alpha Runner

- GitHub Actions workflow: `.github/workflows/ci.yml`.
- Trigger: pushes and pull requests targeting `main`.
- Runtime matrix: Node.js 22.x and 24.x.
- Package manager: Corepack activates the repository `packageManager` pnpm version.
- Validation sequence: `format:check`, `lint`, `typecheck`, `test`, `pack:check`, and
  the Node basic example smoke command.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: public behavior changes without docs/check/test coverage.
- Remaining operational risk: workflow success depends on GitHub-hosted Ubuntu runners and
  official GitHub Actions availability.
