# Registry Consumer Evidence

Status: Last published release-candidate evidence
Owner: 0disoft

This page records the last published candidate rather than predicting evidence for an
unpublished source version. The release workflow verifies each new candidate's registry
bytes and channel after publication; this historical record is updated only from those
public results.

## Candidate

- Package: `@0disoft/openfeature-local-provider@1.0.0-rc.2`.
- npm channel: `next`; npm `latest` remained `0.16.0`.
- GitHub Release: `v1.0.0-rc.2`, marked as a prerelease.
- Release workflow run: `29712977031`, completed successfully on 2026-07-20.

## Artifact Identity

- npm tarball size: 98,580 bytes.
- GitHub Release tarball size: 98,580 bytes.
- SHA-256 for both public tarballs:
  `fbc56fe6b5501d0e690a30b22cf413444a3268c05d67d3ad271f1570d8e7a4d0`.
- npm integrity:
  `sha512-yDDYu2n4B3cX22b2JW73QCXvL3ad1F/6OksjMTkiytHDDfAr6Ru/81KGpjm44BkVL+NMhXjRQEUhlMFWPSQFiA==`.

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
- This matrix predates `1.0.0-rc.2`; the next scheduled or manually dispatched matrix
  remains pending and is not implied by the local rc.2 registry smoke.

## Evidence Boundary

This proves exact public-registry artifact identity and a normal clean install. The
consumer harness is maintained in this repository, so this is not evidence of adoption
or integration by an independently maintained consumer. Stable `1.0.0` remains blocked
until that separate human or external-repository result is recorded through
[GitHub issue #5](https://github.com/0disoft/openfeature-local-provider-audit/issues/5).

## Stable Promotion Enforcement

`docs/testing/independent-consumer-evidence.json` is the source-owned release-gate record.
It is intentionally `pending` while issue #5 has no accepted independent report. After a
maintainer verifies a report, the record must identify the exact candidate package spec,
consumer project and immutable revision, issue URL, normal registry install, independent
maintainer relationship, successful outcome, reviewer, and review timestamp.

`pnpm run stable-release-gate` validates that record. Prereleases and existing `0.x`
releases remain runnable with pending evidence, but stable `1.x` is rejected until the
record is complete and accepted; changing the patch version cannot bypass the gate. This
is an accidental-promotion guard, not a substitute for maintainer review or proof that
the consumer is genuinely independent.
