# Ops Change Checklist

Status: Draft

## Failure Modes

CI drift, unsafe release, unclear rollback, missing observability, config drift, secret handling gaps, backup risk, and incident response gaps.

## Checklist

- CI checks and local validation names are aligned with `VALIDATION.md`.
- Release and rollback conditions are explicit before deployment.
- Logs, metrics, traces, dashboards, alerts, and health checks cover the changed behavior.
- Config and secrets changes have owners, defaults, validation, and leak response.
- Backup, restore, and incident-response docs are updated when operational risk changes.
- Repository hygiene changes are reviewed for line endings, binary diffs, tracked secrets, and ignored artifacts.

## Validation

- Required validation names: docs, smoke, check
- Skipped validation must include a reason and remaining risk.
