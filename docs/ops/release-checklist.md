# Release Checklist

Status: Draft
Owner: 0disoft

## Alpha Readiness

- Apache-2.0 license file present.
- Security reporting policy recorded.
- Package name recorded as `@0disoft/openfeature-local-provider`.
- Runtime targets recorded as server-side Node.js 22 LTS and Node.js 24 LTS.
- `@openfeature/server-sdk` recorded as a peer dependency.
- Static JSON flag evaluation implemented.
- Missing flag and type mismatch behavior tested.
- Package exports smoke tested.

## Beta Readiness

- Env overrides implemented and tested.
- Bucketing v1 implemented with replay fixtures.
- Audit redaction implemented and tested.
- SDK examples use only documented exports.

## Stable Readiness

- Flag schema v1, reason taxonomy, audit event v1, bucketing v1, and package exports are treated as compatibility contracts.
- Semver policy covers flag value changes.
- Release candidate workflow avoids long-lived publish tokens.
- Public npm publishing uses npm trusted publishing from the configured GitHub Actions
  release workflow.
- Stable releases publish to npm `latest`; SemVer prereleases publish to `next` and create
  prerelease-marked GitHub Releases.
- GitHub Releases are created by the release workflow and include the packed `.tgz`
  artifact.
- The tagged commit is contained in `main`, and npm receives the exact tarball that passed
  packed smoke and was uploaded to the GitHub Release.
- `docs/library/migration-to-1.0.md` identifies separate `0.15.x` and `0.16.x` upgrade
  paths and is linked to the current package version by the migration check.
- The exact registry-installed release candidate passes ESM, CJS, TypeScript, CLI,
  watcher, audit, replay, and OpenFeature configuration-event consumer paths.
- At least one separate consumer repository records a normal registry-install result for a
  published release candidate before stable `1.0.0` promotion.
- Consumer evidence uses `.github/ISSUE_TEMPLATE/rc-consumer-report.md` or records the same
  immutable revision, successful CI run, exact package install path, environment, exercised
  surfaces, result, repository separation, and maintainer relationship.
- `docs/testing/cross-repository-consumer-evidence.json` must contain a complete reviewed result.
  The `stable-release-gate` validation rejects stable `1.x` while that record is pending or
  incomplete, including attempts to skip directly to a later patch version.

## 1.0 Release Candidate Readiness

- The documented package-root API and generated API-surface baseline agree.
- Every documented public runtime export is exercised through packed ESM and CJS consumers,
  and every public type is covered by packed TypeScript consumer fixtures.
- The `0.15.x` and `0.16.x` migration paths list every approved candidate difference or
  explicitly preserve the compatibility-sensitive contracts.
- `1.0.0-rc.N` resolves to npm dist-tag `next` and a prerelease-marked GitHub Release.
- Publishing the candidate does not itself satisfy exact registry-artifact installation,
  cross-repository consumer evidence, or stable-promotion gates.

## Review Blockers

- A release skips compatibility-sensitive tests.
- Public package metadata is inconsistent with docs/library/public-api.md.
- Public package metadata is inconsistent with docs/adr/0004-package-license-runtime-policy.md.
- Security or license policy is missing for a public release.
- Trusted publisher settings drift from the GitHub repository or workflow filename.
- Release workflow permissions cannot create the GitHub Release or request npm OIDC.
- A prerelease tag can replace npm `latest`.
- A `1.0` candidate lacks package-version-linked migration guidance.
- Stable `1.0.0` is promoted without exact registry-artifact and cross-repository consumer
  evidence from the candidate series.

## Current RC Evidence

- `v1.0.0-rc.2` includes the insertion-order-independent replay object comparison fix.
  Release run
  [29712977031](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29712977031)
  completed successfully on 2026-07-20.
- npm `latest` resolves to stable `1.0.0`; npm `next` remains `1.0.0-rc.2`.
- npm and GitHub Release tarballs are both 98,580 bytes with SHA-256
  `fbc56fe6b5501d0e690a30b22cf413444a3268c05d67d3ad271f1570d8e7a4d0`.
- Hosted registry-consumer run
  [29648435330](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29648435330)
  passed all six `latest`/`next` jobs across Ubuntu, Windows, and macOS on Node.js 24
  while `next` resolved to `1.0.0-rc.1`. The rc.2 hosted matrix remains pending.
- Separate-repository dogfooding passed in `0disoft/service-catalog-generator` commit
  `119b211f49e9a4824ab168fb4c92bce1a4655908`; CI, action-self-smoke, and CodeQL runs all
  succeeded while the consumer selected real SCG report output through the published RC.
- The machine-readable cross-repository record targets `1.0.0-rc.2`, records the
  `same-maintainer` relationship, and is `accepted`; the consumer-evidence gate no longer
  blocks stable promotion.
- Stable release run
  [29720564101](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29720564101)
  completed successfully. npm and GitHub stable tarballs are both 98,574 bytes with SHA-256
  `bbcbbb6ec60b55262800d82ebeb5bd4af1fd659fdd6ddc8c8a4ebe11344293c0`, and the
  normal-registry `latest` consumer smoke passed.
