# Contract Test Plan

Status: Draft
Owner: 0disoft

## Purpose

Contract tests prove provider behavior that consumers can rely on.

## Required Coverage Once Implementation Exists

- Boolean, string, number, and object static evaluation.
- Explicit JSON and per-flag environment override priority.
- Environment override parse errors return caller defaults with `ERROR` reason metadata.
- Flag keys are not automatically mapped to environment variable names.
- Missing flag returns caller default with `DEFAULT` reason.
- Type mismatch returns caller default with `ERROR` reason and error code.
- Invalid JSON and invalid schema fail at load boundaries.
- Provider adapter does not leak internal exceptions through runtime evaluation.
- Package exports match docs/library/public-api.md.

## Review Blockers

- Public API changes without contract tests.
- Examples exercise undocumented exports.
- Runtime errors bypass default-return behavior.
