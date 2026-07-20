# Replay Fixture v1

Status: Implemented alpha
Repository Type: library

## Purpose

Replay fixtures prove deterministic behavior across implementation changes. They are not
exports of production audit logs.

## Contract

- Fixtures use synthetic, sanitized inputs only.
- Fixtures include the flag snapshot, override input, evaluation request, expected value, reason, source, and relevant error code.
- Bucketing fixtures must include stable expected buckets or variants.
- Fixture updates are required when bucketing, reason taxonomy, env priority, schema, or default behavior changes.
- Replay uses the pure evaluator and must not depend on OpenFeature adapter behavior.

## Fixture Shape

- `schemaVersion`: currently `1`.
- `name`: stable fixture name for failure reports.
- `snapshot`: local flag snapshot under test.
- `overrides`: optional explicit override input with `overridesJson` or injectable `env`.
- `request`: evaluator request including flag key, default value, expected type, and optional targeting key.
- `expected`: expected value, variant, bucket, reason, source, and optional error code.

## Public API

- `replayEvaluationFixture(fixture)` evaluates one fixture and returns pass/fail metadata.
- Mismatches are reported by field and do not throw, so CI and custom harnesses can aggregate failures.
- Object values compare as JSON objects independently of key insertion order, including nested
  objects inside arrays. Array element order remains significant.
- Error message text is intentionally excluded from fixture comparison to avoid overfitting tests to non-contract copy.

## Review Blockers

- Fixtures contain real emails, user IDs, tenant IDs, tokens, IPs, or production flag data.
- Bucketing behavior changes without fixture drift.
- Replay uses OpenFeature adapter behavior when the pure evaluator contract should be tested directly.
