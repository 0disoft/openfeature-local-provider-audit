# Repository Strategy

Status: Draft
Owner: 0disoft

## Purpose

This repository should start as one GitHub repository with one primary package contract.
Provider core, schema, evaluator, audit, replay, and examples are too tightly coupled to
split into multiple repositories before the first implementation.

## Strategy

- Keep one GitHub repository for the MVP.
- Keep one primary npm package until replay or test helpers become large enough to justify a separate package.
- Use `@0disoft/openfeature-local-provider` as the primary npm package name.
- Use Apache-2.0 as the repository and package license.
- Target server-side Node.js 22 LTS and Node.js 24 LTS for the MVP.
- Use pnpm workspaces for the implementation.
- Publish the primary npm package through GitHub Actions and npm trusted publishing.
- Keep `.ssealed/manifest.json` as scaffold baseline metadata, not product source of truth.

## Accepted Decisions

- Package name and npm scope: `@0disoft/openfeature-local-provider`.
- License: Apache-2.0.
- Runtime support matrix: Node.js 22 LTS and Node.js 24 LTS for server-side usage.
- OpenFeature dependency policy: `@openfeature/server-sdk` is a peer dependency.
- Package manager and workspace layout: pnpm workspace with the primary package in `packages/local-provider`.
- Public visibility: package is public on npm.
- Release automation and npm publishing method: tag-triggered GitHub Actions release
  workflow with npm trusted publishing.

## Review Blockers

- Multiple repositories or packages are introduced before a source-of-truth ADR.
- Scaffold metadata becomes the source of product behavior.
- Package metadata drifts from docs/adr/0004-package-license-runtime-policy.md.
- Package manager behavior drifts from docs/adr/0005-pnpm-workspace-policy.md.
