# Backend API Checklist

Status: Draft

## Failure Modes

Auth, authorization, OpenAPI drift, error shape drift, pagination bugs, idempotency gaps, missing logs, and missing tests.

## Checklist

- `api/openapi.yaml` describes every changed request, response, parameter, and error.
- Authentication and authorization behavior is explicit for success and denial cases.
- Pagination uses stable cursors or documented limits and does not expose unbounded reads.
- `Idempotency-Key` behavior is defined for create or retry-prone operations.
- Logs include correlation evidence without secrets or private payloads.
- Contract, negative-path, and smoke validation are run or explicitly skipped.

## Validation

- Required validation names: contract, test, smoke, check
- Skipped validation must include a reason and remaining risk.
