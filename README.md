# OpenFeature Local Provider with Audit Log

Status: Draft
Scope: backend
Repository Type: library
Addons: sdk

This repository defines a small local/default OpenFeature provider for teams that need
feature flags without a SaaS control plane. The initial product direction is file/env
flag loading, typed evaluations, deterministic percentage bucketing, evaluation reasons,
and JSON Lines audit/replay evidence.

## Source Files

- AGENTS.md: agent working rules
- CHECKLIST.md: checklist router
- VALIDATION.md: validation names and reporting requirements
- .agents/context-map.md: agent route map
- docs/product/02-spec.md: product contract and MVP boundary
- docs/product/04-scope-cut.md: explicit MVP inclusion and exclusion list
- docs/library/public-api.md: package API contract
- docs/library/*.md: schema, env override, bucketing, reasons, audit, replay, semver, and compatibility contracts
- docs/security/*.md: privacy, redaction, and local threat model
- docs/testing/*.md: contract and replay test plans
- docs/sdk/public-api.md: SDK-facing API contract
- docs/: design, operations, architecture, and engineering standards

## Repository Shape Notes

- library: owns the provider API, flag file model, env override rules, bucketing behavior,
  audit event shape, package compatibility, and migration guidance.
- sdk: owns consumer examples, OpenFeature integration guidance, compatibility notes, and
  replay fixtures.


## Repository Hygiene

.editorconfig, .gitattributes, and .gitignore are generated to keep line endings,
binary diffs, local files, build outputs, caches, and secret files under control.

## Scope Notes

This project intentionally stays local-provider-first. It must not grow into a hosted
feature flag platform, dashboard, user segmentation database, streaming control plane, or
experiment analytics service without a new product decision and ADR.

Accepted package decisions: Apache-2.0 license, `@0disoft/openfeature-local-provider`
package name, server-side Node.js 22/24 runtime targets, and `@openfeature/server-sdk`
as a peer dependency. The implementation uses a pnpm workspace. Release workflow remains
a pre-implementation decision.
