# Dependency Checklist

Status: Draft

## Failure Modes

Unnecessary dependency, weak maintenance, license mismatch, vulnerability exposure, runtime or bundle impact, and high removal cost.

## Checklist

- The dependency need is tied to a source-of-truth requirement.
- Native alternatives, existing dependencies, and smaller packages were considered.
- License, maintenance health, release cadence, and security posture are reviewed.
- Runtime, bundle, install, transitive dependency, and platform impacts are understood.
- Major upgrades include migration notes, rollback or pinning strategy, and removal cost.

## Validation

- Required validation names: lint, typecheck, test, check
- Skipped validation must include a reason and remaining risk.
