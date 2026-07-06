# Security Checklist

Status: Draft

## Failure Modes

Auth bypass, authorization gaps, tenant leakage, unsafe inputs or outputs, secret exposure, log leakage, and risky external integrations.

## Checklist

- Authentication and authorization checks are owned by the correct boundary.
- Tenant, organization, and user ownership checks cannot be bypassed through alternate paths.
- Inputs and outputs are validated at trust boundaries.
- Secrets are not committed, logged, copied into examples, or exposed through generated artifacts.
- External integrations document scopes, retries, error handling, and redaction.
- Tracked secret files and `.gitignore` exceptions are reviewed.

## Validation

- Required validation names: lint, test, smoke, check
- Skipped validation must include a reason and remaining risk.
