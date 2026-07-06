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
- docs/library/public-api.md: package API contract
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
