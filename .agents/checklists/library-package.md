# Library Package Checklist

Status: Draft

## Failure Modes

Source-of-truth drift, missing validation, missing tests, rollback gaps, and ownership ambiguity.

## Checklist

- The source of truth is named before editing.
- Ownership boundaries and out-of-scope surfaces are respected.
- Required validation names from `VALIDATION.md` are selected.
- Tests or explicit skipped-check reasons are recorded.
- Rollback, recovery, or undo behavior is documented when risk is not trivial.

## Validation

- Required validation names: test, docs, check
- Skipped validation must include a reason and remaining risk.
