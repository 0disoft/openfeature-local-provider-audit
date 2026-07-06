# Replay Fixture v1

Status: Draft
Repository Type: library

## Purpose

Replay fixtures prove deterministic behavior across implementation changes. They are not
exports of production audit logs.

## Contract

- Fixtures use synthetic, sanitized inputs only.
- Fixtures include the flag snapshot, override input, evaluation request, expected value, reason, source, and relevant error code.
- Bucketing fixtures must include stable expected buckets or variants.
- Fixture updates are required when bucketing, reason taxonomy, env priority, schema, or default behavior changes.

## Review Blockers

- Fixtures contain real emails, user IDs, tenant IDs, tokens, IPs, or production flag data.
- Bucketing behavior changes without fixture drift.
- Replay uses OpenFeature adapter behavior when the pure evaluator contract should be tested directly.
