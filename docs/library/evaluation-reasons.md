# Evaluation Reasons

Status: Draft
Repository Type: library

## Purpose

Evaluation reasons explain why a value was returned. Reason names are part of the public
testing and audit contract.

## Initial Taxonomy

- `STATIC`: value came from a file-defined static variant.
- `DEFAULT`: caller default was returned.
- `ENV_OVERRIDE`: value came from an explicit env override.
- `SPLIT`: value came from deterministic percentage bucketing.
- `ERROR`: evaluation hit a parse, schema, type, readiness, or override error.

## Error Code Candidates

- `PARSE_ERROR`
- `SCHEMA_ERROR`
- `FLAG_NOT_FOUND`
- `TYPE_MISMATCH`
- `INVALID_CONTEXT`
- `OVERRIDE_PARSE_ERROR`
- `PROVIDER_NOT_READY`
- `AUDIT_SINK_ERROR`

## Review Blockers

- Reason names change without semver notes.
- Error paths return successful-looking reasons.
- Tests or examples rely on undocumented reason strings.
