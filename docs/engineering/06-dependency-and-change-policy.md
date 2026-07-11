# Dependency and Change Policy

Status: Draft

## Contract

Dependencies should preserve a small local-provider package. Adding parsers, hash
libraries, OpenFeature bindings, or filesystem helpers is a compatibility and supply-chain
decision, not filler.

## Required Evidence

- Source of truth: docs/product/02-spec.md
- Owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Policy

- Runtime dependencies need a clear role in provider evaluation, file parsing, redaction, or replay.
- Hashing and bucketing dependencies are compatibility-sensitive.
- YAML support is accepted through docs/adr/0006-yaml-snapshot-loader.md and must keep
  JSON-compatible schema validation.
- File reload/watch support is accepted through docs/adr/0007-file-reload-watch.md and
  must keep evaluation file-I/O free.
- CLI helper support is accepted through docs/adr/0008-cli-helpers.md and must stay
  local, read-only, and file-based.
- Browser, Bun, Deno, or other runtime support must be proven before being documented as supported.
- Dependencies must not introduce a hosted-service assumption.

## Update Automation

- Dependabot checks the root pnpm workspace monthly.
- Development dependency minor and patch updates are grouped to reduce review noise.
- Runtime, peer, and major updates remain separate pull requests because parser output,
  OpenFeature compatibility, package exports, and toolchain migrations need independent evidence.
- Automated pull requests must pass the same coverage, package, consumer, and runtime matrix gates
  as maintainer-authored changes. Dependabot does not authorize automatic merging or publishing.

## Review Blockers

- A change bypasses the source of truth.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
