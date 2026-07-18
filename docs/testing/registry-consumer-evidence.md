# Registry Consumer Evidence

Status: Current release-candidate evidence
Owner: 0disoft

## Candidate

- Package: `@0disoft/openfeature-local-provider@1.0.0-rc.1`.
- npm channel: `next`; npm `latest` remained `0.16.0`.
- GitHub Release: `v1.0.0-rc.1`, marked as a prerelease.
- Release workflow run: `29646276937`, completed successfully on 2026-07-18.

## Artifact Identity

- npm tarball size: 98,118 bytes.
- GitHub Release tarball size: 98,118 bytes.
- SHA-256 for both public tarballs:
  `7412cfedfd84f169c778e0881eb5a0c2bff1d325e091596e278bac08147cc9b8`.
- npm integrity:
  `sha512-dgwhq+Q5yYBL5vv52WQtcfnCLJH9Gw6u3ZYjN9bA9QwPpXtfAtNKkBIlffJ9luSrUajlck2OUMugzxfp7tLZfQ==`.

## Normal Registry Install

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

## Evidence Boundary

This proves exact public-registry artifact identity and a normal clean install. The
consumer harness is maintained in this repository, so this is not evidence of adoption
or integration by an independently maintained consumer. Stable `1.0.0` remains blocked
until that separate human or external-repository result is recorded through
[GitHub issue #5](https://github.com/0disoft/openfeature-local-provider-audit/issues/5).
