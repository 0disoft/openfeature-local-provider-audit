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
- Packed declaration consumption runs twice: TypeScript 5.9.3 checks the complete dependency
  declaration graph with `skipLibCheck: false`, while the repository TypeScript version checks
  the package consumer surface with `skipLibCheck: true`. The latter isolates the package contract
  from the known TypeScript 6 incompatibility inside `@openfeature/server-sdk@1.22.0` declarations;
  it must not be described as a complete dependency-library type check.
- Packed smoke rejects release tarballs larger than 1 MiB (1,048,576 bytes). This is a
  compressed artifact budget intended to catch accidentally shipped fixtures, caches, or
  generated output; raising it requires a reviewed package-content explanation.
- `registry-smoke` creates a temporary consumer outside the workspace, installs the exact
  source package version by name from the normal npm registry, confirms the installed
  package metadata, records registry tarball integrity and SHA-256, and then runs the same
  ESM, CJS, TypeScript, CLI, watcher, event, replay, and audit contract as packed smoke.
  This proves registry installation, not separate-repository adoption.
- `.github/workflows/registry-consumer.yml` runs weekly, on manual dispatch, and when its
  workflow or registry-consumer harness changes on `main`. It installs both npm `latest`
  and `next` on Node.js 24 across Ubuntu, Windows, and pinned macOS 15, using the registry
  smoke contract. Channel failures expose publication or platform drift without treating
  the package-repository matrix as cross-repository consumer evidence.
- `.github/workflows/audit-queue-benchmark.yml` runs only on manual dispatch. Its `quick`
  profile runs one small sample on Node.js 24.x across Ubuntu, Windows, and macOS. Its
  `decision` profile runs three repeated 1-second, 5-second, and 30-second stall samples
  on every platform; `custom` preserves one-off workload input. A planning job creates the
  dynamic matrix, and at most nine benchmark jobs run concurrently. A dependent job
  validates every platform repetition and queue
  accounting contract, rejects failed writes, and publishes raw runs, aggregate JSON, and
  Markdown summaries with median and worst observed measurements. Sampled timing and heap
  values are visible but are not merge or release gates.
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
