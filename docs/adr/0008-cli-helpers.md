# CLI Helpers

Status: Accepted
Owner: 0disoft

## Context

The package now supports JSON/YAML snapshot parsing, explicit file loading, and reload
boundaries. Consumers still need a small way to validate local flag files in CI or before
starting a local service without writing an application script.

CLI support was deferred because a broad command surface could make this package look like
a flag management platform. The useful narrow case is local snapshot validation only.

## Decision

- Add a package binary named `openfeature-local-provider`.
- Add `openfeature-local-provider validate <file>` for local JSON/YAML snapshot validation.
- Support extension-based auto-detection and `--format auto|json|yaml`.
- Support `--json` for a machine-readable validation summary.
- Keep the CLI local and file-based. It must not evaluate user targeting contexts, run a
  watcher process, contact a network service, manage remote flags, or mutate flag files.
- Print validation errors without echoing raw file contents.

## Compatibility Impact

- The package artifact gains a public `bin` entry.
- Existing root exports and provider behavior are unchanged.
- CLI exit codes are part of the command contract:
  - `0`: success.
  - `1`: snapshot load or validation failure.
  - `2`: usage error.

## Validation

- Unit tests must cover valid JSON, valid YAML, explicit format selection, invalid
  snapshots, and usage errors.
- Package checks must verify that the bin entry is present in the published package.
- Release readiness must stay green before publishing.

## Review Blockers

- The CLI starts a long-running watcher or background process.
- The CLI contacts a hosted service, remote control plane, database, or network API.
- The CLI prints raw flag file contents on validation failure.
- The CLI changes provider evaluation behavior or public root exports without a matching
  semver review.
