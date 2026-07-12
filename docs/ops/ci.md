# CI

Status: Draft

## Operational Contract

CI proves docs, package checks, type safety, tests, replay fixtures, and package hygiene
on the supported Node.js runtime matrix.

## Implemented Runner

- GitHub Actions workflow: `.github/workflows/ci.yml`.
- Trigger: pushes and pull requests targeting `main`.
- Runtime matrix: Node.js 22.x and 24.x on `ubuntu-latest`, `windows-latest`, and
  `macos-15` hosted runners.
- macOS is pinned to version 15 so GitHub's `macos-latest` migration does not silently
  change the toolchain. Adopt a newer macOS image only after the full Node matrix passes
  on that explicit runner label.
- Package manager: Corepack activates the repository `packageManager` pnpm version.
- Official GitHub Actions are pinned to full commit SHAs, with the reviewed tag noted in
  workflow comments.
- `.github/dependabot.yml` checks the pnpm workspace monthly. Development minor and patch
  updates are grouped, while production, peer, and major updates remain independently reviewable.
- `.github/workflows/compatibility.yml` runs weekly and on manual dispatch. It installs the
  newest `@openfeature/server-sdk` version allowed by the package peer range into the packed
  consumer smoke project without changing the lockfile, compiles a strict TypeScript
  consumer, and then runs ESM, CJS, and CLI checks.
- Validation sequence: `format:check`, `lint`, `typecheck`, `test`, release readiness,
  `pack:check`, the Node basic example smoke command, and packed package smoke for ESM,
  CJS, and CLI bin behavior.
- Ubuntu Node.js 24.x runs `test:coverage` instead of the plain test command and enforces the
  package coverage thresholds. Other matrix entries avoid duplicate coverage instrumentation.
- `typecheck` covers both the published package source and the Node consumer example so
  public API type drift fails before the runtime smoke step. It builds package declarations
  before checking the consumer so a clean checkout resolves the same public export surface.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: public behavior changes without docs/check/test coverage.
- Remaining operational risk: workflow success depends on GitHub-hosted Ubuntu, Windows,
  and macOS runners and official GitHub Actions availability.
