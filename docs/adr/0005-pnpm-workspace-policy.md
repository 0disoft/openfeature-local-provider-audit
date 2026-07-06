# pnpm Workspace Policy

Status: Accepted
Owner: 0disoft

## Context

The first implementation needs a package manager and workspace layout. The repository is
intended to start as one GitHub repository with one primary npm package and examples that
can share local package references.

## Decision

- Use pnpm workspaces for the repository.
- Keep the primary package at `packages/local-provider`.
- Keep examples under `examples/`.
- Keep one published package for the MVP: `@0disoft/openfeature-local-provider`.

## Consequences

- `pnpm-lock.yaml` is committed as package-manager state.
- Validation scripts use `pnpm --filter`.
- Package manager changes require an ADR update.

## Review Blockers

- A second publishable package is added before the MVP proves the split.
- Package scripts require npm, Yarn, Bun, or another package manager without updating this ADR.
