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
- Deterministic rollout returns stable bucket, variant, `SPLIT` reason, and file source.
- Missing rollout targeting key returns caller default with `ERROR` reason and `INVALID_CONTEXT`.
- Replay fixtures compare pure evaluator output without relying on the OpenFeature adapter.
- Audit event serialization excludes raw context and evaluated flag values by default.
- File audit sink writes JSON Lines records, and provider audit write failures do not change
  evaluation results.
- Provider audit writes are non-blocking by default, with blocking mode covered for
  deterministic tests and short-lived scripts.
- Missing flag returns caller default with `DEFAULT` reason.
- Type mismatch returns caller default with `ERROR` reason and error code.
- Invalid JSON and invalid schema fail at load boundaries.
- Provider adapter does not leak internal exceptions through runtime evaluation.
- Package exports match docs/library/public-api.md.

## Review Blockers

- Public API changes without contract tests.
- Examples exercise undocumented exports.
- Runtime errors bypass default-return behavior.
