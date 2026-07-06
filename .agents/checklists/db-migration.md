# DB Migration Checklist

Status: Draft

## Failure Modes

Unsafe expand-contract rollout, missing rollback or forward-fix path, large table locks, unsafe indexes, and weak data verification.

## Checklist

- `db/schema.dbml` and migration notes agree on source-of-truth structure.
- The migration separates expand, backfill, switch, and contract phases when needed.
- Large table operations have lock, timeout, batching, and index-build risk called out.
- Rollback or forward-fix behavior is documented for every irreversible step.
- Data verification queries or checks are named before and after deployment.

## Validation

- Required validation names: migration-check, test, smoke, check
- Skipped validation must include a reason and remaining risk.
