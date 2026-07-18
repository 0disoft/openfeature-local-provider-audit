# npm Publishing

Status: Draft
Owner: 0disoft

## Purpose

Publishing policy is finalized for the current release path. The repository avoids
long-lived publish tokens and requires package export, type, license, provenance, and
smoke evidence before public release.

## Accepted Decisions

- Package name and npm scope: `@0disoft/openfeature-local-provider`.
- License: Apache-2.0.
- Runtime support matrix: server-side Node.js 22 LTS and Node.js 24 LTS.
- OpenFeature SDK dependency policy: `@openfeature/server-sdk` peer dependency.
- Package manager and workspace layout: pnpm workspace.
- npm publishing method: npm trusted publishing from GitHub Actions.
- Trusted publisher: GitHub organization or user `0disoft`, repository
  `openfeature-local-provider-audit`, workflow filename `release.yml`.

## Implemented Release Flow

- `.github/workflows/release.yml` builds release candidates on `v*` tag pushes.
- The workflow rejects tags that do not match the package version.
- The workflow rejects tagged commits that are not contained in `origin/main`.
- The workflow runs package validation and uploads the packed `.tgz` artifact.
- The isolated publish job checks whether the package version is already published.
- The publish job requires npm CLI 11.5.1 or newer before requesting trusted-publishing
  credentials.
- If the version is not already published, the workflow publishes the already packed and
  tested tarball with
  `npm publish "${{ steps.pack.outputs.tarball }}" --provenance --access public --tag
  "${{ steps.channel.outputs.npm-tag }}"`.
- Stable versions resolve to npm dist-tag `latest`; versions with a SemVer prerelease
  identifier resolve to npm dist-tag `next` and create prerelease-marked GitHub Releases.
- After publishing or finding an existing version, the workflow downloads the registry
  tarball and requires its SHA-256 and dist-tag to match the tested candidate. A separate
  job creates the GitHub Release and attaches those registry-downloaded bytes.
- It does not use a long-lived npm token.

## Release Gate Candidates

- Typecheck.
- Unit tests.
- Contract and replay fixtures.
- Redaction tests.
- Package export smoke test.
- Packed install smoke test.
- License check.
- Peer dependency smoke test.
- Release readiness policy check.

## Review Blockers

- A publish workflow requires a long-lived npm token without an explicit ADR.
- Package metadata claims runtime or API support that tests do not prove.
- Package metadata differs from docs/adr/0004-package-license-runtime-policy.md.
- A public release is prepared before security policy is present.
- npm trusted publisher configuration no longer matches the GitHub organization,
  repository, or workflow filename recorded above.
- Release workflow permissions cannot create the GitHub Release or request npm OIDC.
