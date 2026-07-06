# Validation

Status: Draft

## Validation Source of Truth

This document owns stable validation names for this local OpenFeature provider package.
Until an executable runner exists, validation is documentation and repository-hygiene
evidence only.

## Standard Validation Names

- format
- lint
- typecheck
- test
- contract
- migration-check
- smoke
- docs
- check

## Required Final Report

Final responses must list executed validations, passed validations, skipped validations, skip reasons, and remaining risk.

## Runner Policy

Task runner files are optional. Runner `none` means no executable task runner is generated.
If a runner is generated, runner command names must match this document.
Unconfigured runner commands must fail, not pass with a fake success.

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
- check: repository hygiene confirms no unowned API server, DB schema, secret, or generated output is treated as source truth.
