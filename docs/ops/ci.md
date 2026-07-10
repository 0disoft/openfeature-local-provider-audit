# CI

Status: Draft

## Operational Contract

CI proves docs, package checks, type safety, tests, replay fixtures, and package hygiene
on the supported Node.js runtime matrix.

## Implemented Runner

- GitHub Actions workflow: `.github/workflows/ci.yml`.
- Trigger: pushes and pull requests targeting `main`.
- Runtime matrix: Node.js 22.x and 24.x on Ubuntu, Windows, and macOS hosted
  runners.
- Package manager: Corepack activates the repository `packageManager` pnpm version.
- Official GitHub Actions are pinned to full commit SHAs, with the reviewed tag noted in
  workflow comments.
- Validation sequence: `format:check`, `lint`, `typecheck`, `test`, release readiness,
  `pack:check`, the Node basic example smoke command, and packed package smoke for ESM,
  CJS, and CLI bin behavior.
- `typecheck` covers both the published package source and the Node consumer example so
  public API type drift fails before the runtime smoke step.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: public behavior changes without docs/check/test coverage.
- Remaining operational risk: workflow success depends on GitHub-hosted Ubuntu, Windows,
  and macOS runners and official GitHub Actions availability.
