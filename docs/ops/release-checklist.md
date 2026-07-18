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
- At least one independently maintained consumer records a normal registry-install result
  for a published release candidate before stable `1.0.0` promotion.
- External consumer evidence uses `.github/ISSUE_TEMPLATE/rc-consumer-report.md` or records
  the same immutable revision, exact package install path, environment, exercised surfaces,
  result, and maintainer relationship.

## 1.0 Release Candidate Readiness

- The documented package-root API and generated API-surface baseline agree.
- Every documented public runtime export is exercised through packed ESM and CJS consumers,
  and every public type is covered by packed TypeScript consumer fixtures.
- The `0.15.x` and `0.16.x` migration paths list every approved candidate difference or
  explicitly preserve the compatibility-sensitive contracts.
- `1.0.0-rc.N` resolves to npm dist-tag `next` and a prerelease-marked GitHub Release.
- Publishing the candidate does not itself satisfy exact registry-artifact installation,
  independent-consumer feedback, or stable-promotion gates.

## Review Blockers

- A release skips compatibility-sensitive tests.
- Public package metadata is inconsistent with docs/library/public-api.md.
- Public package metadata is inconsistent with docs/adr/0004-package-license-runtime-policy.md.
- Security or license policy is missing for a public release.
- Trusted publisher settings drift from the GitHub repository or workflow filename.
- Release workflow permissions cannot create the GitHub Release or request npm OIDC.
- A prerelease tag can replace npm `latest`.
- A `1.0` candidate lacks package-version-linked migration guidance.
- Stable `1.0.0` is promoted without exact registry-artifact and independent-consumer
  evidence from the candidate series.

## Current RC Evidence

- `v1.0.0-rc.1` release run `29646276937` completed successfully on 2026-07-18.
- npm `next` resolves to `1.0.0-rc.1`; npm `latest` remains `0.16.0`.
- npm and GitHub Release tarballs are both 98,118 bytes with SHA-256
  `7412cfedfd84f169c778e0881eb5a0c2bff1d325e091596e278bac08147cc9b8`.
- The repository-owned normal-registry consumer passed. Independent maintainer feedback
  remains required before stable promotion.
