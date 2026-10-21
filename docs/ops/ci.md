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
- Node.js 26 has one additional Linux packed-consumer canary in the weekly/manual
  compatibility workflow only. It uses the latest compatible peer, a frozen lockfile,
  read-only permissions, and a 15-minute timeout. Node 26 is experimental; promotion
  requires LTS status, Linux/Windows/macOS evidence, and a deliberate minor release as
  defined in `docs/library/compatibility.md`. It does not expand the push/PR matrix.
- Packed declaration consumption runs twice: TypeScript 5.9.3 checks the complete dependency
  declaration graph with `skipLibCheck: false`, while the repository TypeScript version checks
  the package consumer surface with `skipLibCheck: true`. The latter isolates the package contract
  from the known newer-compiler incompatibility inside `@openfeature/server-sdk@1.22.0` declarations;
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
  workflow or registry-consumer harness changes on `main`. It resolves npm dist-tags once and always tests `latest`
  on Node.js 24 across Ubuntu, Windows, and pinned macOS 15. It also tests `next` only
  when that tag is a prerelease newer than `latest`; missing, malformed, stable, equal,
  or superseded `next` tags leave the three stable jobs intact. A missing or invalid
  `latest` fails planning. Each job consumes the exact resolved version. Manual dispatch
  accepts an exact version or dist-tag through the `version` input without changing the
  schedule. Values pass through environment variables rather than shell interpolation. Channel failures expose publication or platform drift without treating
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

## TypeScript 7 Toolchain

The package build uses tsdown and the native TypeScript 7 declaration generator with
`skipLibCheck: false`. `typescript-api` is an explicit TypeScript 6 development alias
used only by the public API comparator. The consumer-surface fixture uses TypeScript 7;
the separate strict TypeScript 5.9.3 fixture still checks the full dependency graph.
See `docs/adr/0012-typescript-7-toolchain.md` for rollback and native package review.

## Dependency Updates

Dependency declarations accept stable updates within their reviewed major (with caret
ranges; pre-1.0 tools stay within their reviewed minor). The frozen pnpm lockfile owns
CI/build reproducibility. Packed consumers use the actual installed compiler and Node
type versions from that lockfile, not an independently resolved floating compiler.
Keep Vitest and its coverage provider on the same release. Review major upgrades with
compatibility checks; do not promote Node type definitions beyond the supported
runtime major. The example and library tooling use Node 24 types consistently.

The Corepack `packageManager` field remains an exact pnpm release because it selects
the package-manager executable. GitHub Actions remain full immutable SHAs. Both are
reviewed updates rather than permanent application-dependency version freezes.

## Vitest 5 Upgrade

Vitest and `@vitest/coverage-v8` now use the reviewed `^5.0.5` major together. The
[Vitest 5 migration guide](https://vitest.dev/guide/migration/) requires Node 22.12+
and Vite 6.4+; current Node 22/24 CI and the patched Vite 8 toolchain meet those
requirements. Tests create mocks per case, do not use inline projects or custom
coverage-provider APIs, and pass with the new mock-clearing defaults. Coverage
thresholds remain unchanged. This is a development-tool upgrade; the provider API,
runtime engines, and published runtime dependencies are unchanged.

Rollback: restore `vitest` and `@vitest/coverage-v8` to the prior reviewed `^4.1.12`
range and restore their lockfile together, then rerun typecheck and coverage.

## pnpm 12 Upgrade

The project pins `pnpm@12.14.0`; see the
[pnpm 12 release notes](https://github.com/pnpm/pnpm/releases/tag/v12.0.0).
pnpm 12 validates workspace setting names and records
its package-manager resolution alongside application dependencies in the lockfile.
The workspace uses supported settings and public-registry dependencies; no hosted Git
dependency transport migration is needed. Commit all pnpm-generated lockfile documents
together. Frozen installs, package scripts, tarball packing, and temporary-consumer
installs must pass before accepting this major.

CI continues to enable Corepack and use the repository pin. On a Windows machine where
an older global pnpm launcher fails to bootstrap the new native executable, use
`corepack pnpm` directly; do not change global installation settings as part of this
repository upgrade. Nested project scripts inherit pnpm's selected executable.

Rollback: restore `packageManager` to `pnpm@11.28.6`, the matching release-readiness
expectation, and the preceding lockfile together. Restore the prior dependency tree
with `corepack pnpm install --frozen-lockfile` before running validations again.
