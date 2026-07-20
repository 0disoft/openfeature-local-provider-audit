# Registry Consumer Evidence

Status: Published stable and last release-candidate evidence
Owner: 0disoft

This page records the published stable release and the last published candidate. The release
workflow verifies registry bytes and channels after publication; this record is updated only
from those public results.

## Stable Release

- Package: `@0disoft/openfeature-local-provider@1.0.0`.
- npm channel: `latest`; npm `next` remained `1.0.0-rc.2`.
- GitHub Release: [v1.0.0](https://github.com/0disoft/openfeature-local-provider-audit/releases/tag/v1.0.0),
  published as a non-draft stable release on 2026-07-20.
- Release workflow run:
  [29720564101](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29720564101),
  completed successfully.
- npm and GitHub Release tarball size: 98,574 bytes each.
- SHA-256 for both public tarballs:
  `bbcbbb6ec60b55262800d82ebeb5bd4af1fd659fdd6ddc8c8a4ebe11344293c0`.
- npm integrity:
  `sha512-AxPAeIqnlKdRiiVQczJICwWLB82TnxSSSDv6bHQDF8TABnaRS67ZLn9vJ7AJqwrS3uJDccj3EINhkya1AZ6gwA==`.
- Normal-registry `latest` smoke passed on Windows x64 with Node.js `v24.18.0`,
  `@openfeature/server-sdk@1.22.0`, strict TypeScript `5.9.3`, and consumer-surface
  TypeScript `6.0.3`.

## Last Published Candidate

- Package: `@0disoft/openfeature-local-provider@1.0.0-rc.2`.
- npm channel: `next`; npm `latest` remained `0.16.0`.
- GitHub Release: `v1.0.0-rc.2`, marked as a prerelease.
- Release workflow run: `29712977031`, completed successfully on 2026-07-20.

## Candidate Artifact Identity

- npm tarball size: 98,580 bytes.
- GitHub Release tarball size: 98,580 bytes.
- SHA-256 for both public tarballs:
  `fbc56fe6b5501d0e690a30b22cf413444a3268c05d67d3ad271f1570d8e7a4d0`.
- npm integrity:
  `sha512-yDDYu2n4B3cX22b2JW73QCXvL3ad1F/6OksjMTkiytHDDfAr6Ru/81KGpjm44BkVL+NMhXjRQEUhlMFWPSQFiA==`.

## Candidate Normal Registry Install

The repository-owned `registry-smoke` validation created a temporary consumer outside
the workspace and installed the exact package version by name from the normal npm
registry. It did not use a workspace link, checkout `dist`, or a local tarball.

- Result: `registry-consumer-smoke-passed`.
- Platform: Windows x64 (`win32-x64`).
- Node.js: `v24.18.0`.
- `@openfeature/server-sdk`: `1.22.0`.
- Full dependency declaration check: TypeScript `5.9.3`, `skipLibCheck: false`.
- Current consumer-surface check: TypeScript `6.0.3`, `skipLibCheck: true`.
- Runtime coverage: ESM, CJS, CLI, OpenFeature registration and evaluation, environment
  priority, replay, watcher reload, configuration-change events, audit redaction, audit
  sink flush, and shutdown.

## Hosted Registry Matrix

- Workflow run: [29648435330](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29648435330).
- Tested commit: `ba4220d6195aa0e40ae823f3cfe82c1d8dfa7e94`.
- Result: all six Node.js 24 jobs completed successfully on 2026-07-18.
- Matrix: npm `latest` and `next` on `ubuntu-latest`, `windows-latest`, and pinned
  `macos-15`.
- Every job completed the clean dependency install and `Consume published package` step.
- `latest` covered `0.16.0`; `next` covered `1.0.0-rc.1`.
- This matrix predates `1.0.0-rc.2`; the next scheduled or manually dispatched matrix
  remains pending and is not implied by the local rc.2 registry smoke.

## Cross-Repository Consumer

The published candidate is also installed in the separate
[`0disoft/service-catalog-generator`](https://github.com/0disoft/service-catalog-generator)
repository at commit `119b211f49e9a4824ab168fb4c92bce1a4655908`.

- Package spec: `@0disoft/openfeature-local-provider@1.0.0-rc.2`, resolved from the normal
  npm registry through the committed pnpm lockfile.
- OpenFeature peer: `@openfeature/server-sdk@1.22.0`.
- Consumer behavior: three boolean flags select JSON and HTML output while suppressing DOT,
  then the built SCG CLI compiles two services and the fixture verifies the generated files.
- Main CI run:
  [29716348265](https://github.com/0disoft/service-catalog-generator/actions/runs/29716348265),
  completed successfully on 2026-07-20.
- Additional successful runs:
  [action-self-smoke 29716348297](https://github.com/0disoft/service-catalog-generator/actions/runs/29716348297)
  and [CodeQL 29716348289](https://github.com/0disoft/service-catalog-generator/actions/runs/29716348289).
- Provider-side review record:
  [GitHub issue #5](https://github.com/0disoft/openfeature-local-provider-audit/issues/5).
- Maintainer relationship: `same-maintainer`. This is disclosed ownership, not an
  independent-maintainer claim.

## Evidence Boundary

The package repository's own harness proves exact artifact identity and broad package-surface
compatibility. The SCG result adds actual use in a separate repository with its own lockfile,
build, CLI behavior, tests, and hosted CI. Both repositories are maintained by `0disoft`, so the
result proves cross-repository dogfooding but not organizational independence.

## Stable Promotion Enforcement

`docs/testing/cross-repository-consumer-evidence.json` is the source-owned release-gate record.
It accepts the SCG result and identifies the exact candidate package spec, separate consumer
project and immutable revision, successful consumer CI run, issue URL, normal registry install,
disclosed maintainer relationship, outcome, reviewer, and review timestamp.

`pnpm run stable-release-gate` validates that record. Prereleases and existing `0.x`
releases remain runnable with pending evidence, but stable `1.x` is rejected until a complete
cross-repository result is accepted; changing the patch version cannot bypass the gate. The
accepted same-maintainer result is sufficient because repository separation, normal-registry
installation, immutable revision, hosted CI, and ownership disclosure are all enforced.
