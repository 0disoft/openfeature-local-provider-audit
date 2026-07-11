# Validation

Status: Draft

## Validation Source of Truth

This document owns stable validation names for this local OpenFeature provider package.
Executable validation now runs through pnpm package scripts.

## Standard Validation Names

- format
- lint
- typecheck
- test
- coverage
- contract
- migration-check
- smoke
- docs
- check

## Required Final Report

Final responses must list executed validations, passed validations, skipped validations, skip reasons, and remaining risk.

## Runner Policy

The configured runner is pnpm. Runner command names must match this document.
Unconfigured runner commands must fail, not pass with a fake success.

## Runner Commands

- format: `pnpm run format:check`
- lint: `pnpm run lint`
- typecheck: `pnpm run typecheck`
- test: `pnpm run test`
- coverage: `pnpm run test:coverage`
- smoke: `pnpm run build` and `pnpm run pack:check`
- docs: `pnpm run release-readiness`
- check: `pnpm run check`

## Hygiene Validation

Repository hygiene file changes must check line-ending churn, binary diff pollution,
tracked secret files, ignored build/cache artifacts, and generated-output drift.

Intentional customization of generated scaffold documents may appear as `.ssealed`
checksum drift. Report that drift explicitly; do not update the generated manifest unless
the owner asks to rebaseline the scaffold.

## Scope

backend validation routes must stay stack-neutral unless a runner file explicitly defines a command.

## Repository Shape

library, sdk validation must stay repository-shape focused and must not imply generated application source code.

## Project-Specific Evidence

- docs: product, library, SDK, architecture, backend, ops, and engineering documents agree on the local-provider boundary.
- contract: public API docs identify bucketing, reason names, env override priority, audit event fields, and replay fixtures as compatibility-sensitive.
- security: privacy and threat-model docs confirm raw context, secrets, and evaluated object values are not logged by default.
- test: contract and replay tests cover default-return behavior, redaction, and deterministic bucketing.
- check: repository hygiene confirms no unowned API server, DB schema, secret, or generated output is treated as source truth.
