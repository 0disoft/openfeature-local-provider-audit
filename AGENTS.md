# AGENTS.md

## Repository Scope

Scope: backend

This repository owns a local OpenFeature provider library and SDK surface for file/env
feature flags, deterministic bucketing, evaluation reasons, snapshot/replay fixtures,
and redacted evaluation audit logs.

This repository does not own a hosted flag service, control-plane UI, experiment
analytics product, approval workflow, user segment database, or remote rollout
management server.

Consumer-facing behavior is contracted through `docs/product/02-spec.md`,
`docs/product/04-scope-cut.md`, `docs/library/public-api.md`, `docs/sdk/public-api.md`,
the detailed contracts under `docs/library/`, and compatibility notes under
`docs/library/` and `docs/sdk/`.

## Repository Shape

Primary repository type: library
Addons: sdk

- library: This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.
- sdk: This repository type owns public API, compatibility, examples, versioning, and consumer migration.


## Source of Truth

- Product scope: docs/product/02-spec.md
- MVP scope cut: docs/product/04-scope-cut.md
- Repository strategy: docs/repository/00-repository-strategy.md
- Package/license/runtime policy: docs/adr/0004-package-license-runtime-policy.md
- Detailed library contracts: docs/library/*.md
- Security and privacy: docs/security/*.md
- Testing plans: docs/testing/*.md
- Architecture decisions: docs/adr/*.md
- Validation: VALIDATION.md
- Agent routing: .agents/context-map.md
- Repository hygiene: .editorconfig, .gitattributes, .gitignore

## Hard Rules

- Do not generate unowned application, service, UI, database, or infrastructure source code.
- Do not invent technology choices. Use UNDECIDED when a decision is not known.
- Do not create fake credentials, tokens, secrets, or private values.
- Do not rely on generated, cache, or build output as source truth.

## Repository Hygiene

- .editorconfig sets line ending, encoding, and final newline policy.
- .gitattributes sets Git text normalization and binary diff policy.
- .gitignore excludes local, secret, build, and cache artifacts.
- Generated, cache, and build output must not be used as design-document evidence.
- Do not create large diffs that only change line endings.

## Before Editing

- Read this file, VALIDATION.md, CHECKLIST.md, and .agents/context-map.md.
- Read the skill and checklist named by the context map.
- Confirm source-of-truth documents before changing contracts.

## Out of Scope

- Application source scaffolding.
- Runtime infrastructure such as Docker, Kubernetes, Terraform, or framework apps.
- Project-specific credentials or deployment secrets.

## Final Response Requirements

- List executed validations, passed validations, skipped validations, skip reasons, and remaining risk.
- Name any source-of-truth documents changed.
- Call out API, DB, repository hygiene, and runner changes explicitly.
