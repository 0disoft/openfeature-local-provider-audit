# Contract Test Plan

Status: Draft
Owner: 0disoft

## Purpose

Contract tests prove provider behavior that consumers can rely on.

## Required Contract Coverage

- Boolean, string, number, and object static evaluation.
- JSON and YAML snapshot parsing through the same schema validation boundary.
- Explicit JSON and per-flag environment override priority.
- Environment override parse errors return caller defaults with `ERROR` reason metadata.
- Flag keys are not automatically mapped to environment variable names.
- Deterministic rollout returns stable bucket, variant, `SPLIT` reason, and file source.
- Missing rollout targeting key returns caller default with `ERROR` reason and `INVALID_CONTEXT`.
- Replay fixtures compare pure evaluator output without relying on the OpenFeature adapter.
- Audit event serialization excludes raw context and evaluated flag values by default.
- Audit snapshot hashing uses locale-independent key ordering.
- File audit sink writes JSON Lines records, and provider audit write failures do not change
  evaluation results.
- Provider audit writes are non-blocking by default, with blocking mode covered for
  deterministic tests and short-lived scripts.
- File audit sink flush waits for pending non-blocking writes before short-lived
  processes exit, including writes queued after an earlier write failure.
- File audit sink rotation enforces configured `maxBytes` and retained `maxFiles`.
- File audit sink advisory locking covers lock acquisition, timeout, and stale lock
  recovery.
- File audit sink bounded queue tests cover invalid capacity, reject overflow,
  drop-newest overflow, and pending/dropped write stats.
- Missing flag returns caller default with `DEFAULT` reason.
- Type mismatch returns caller default with `ERROR` reason and error code.
- Invalid JSON and invalid schema fail at load boundaries.
- Snapshot files at the exact byte limit pass, oversized snapshot files fail during the
  bounded read before parsing, and oversized explicit JSON overrides fail before parsing.
- Provider adapter converts internal runtime evaluation exceptions to caller defaults
  with `ERROR` reason and `PROVIDER_NOT_READY` error details.
- Package exports match docs/library/public-api.md.
- CLI tests cover help and version output, format selection, invalid snapshot exit `1`, and
  argument or usage errors exiting `2` without reading unintended extra paths.

## Implemented Coverage

- Unit tests cover JSON and YAML schema parsing, static typed evaluation, missing flags,
  type mismatch, environment overrides, deterministic bucketing, replay fixtures,
  redacted audit event serialization, file audit sink behavior, provider default-return
  behavior, and package exports.
- The Node basic example exercises OpenFeature registration, JSON snapshot loading,
  deterministic rollout, replay verification, and audit sink flushing.
- CI runs contract coverage on Node.js 22.x and Node.js 24.x.
- CI enforces the package coverage threshold on Ubuntu with Node.js 24.x while the remaining
  matrix entries run the same contract tests without duplicate coverage instrumentation.

## Review Blockers

- Public API changes without contract tests.
- Examples exercise undocumented exports.
- Runtime errors bypass default-return behavior.
