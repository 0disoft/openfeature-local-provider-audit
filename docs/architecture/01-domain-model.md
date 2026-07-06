# Domain Model

Status: Draft

## Boundary

The domain model is small on purpose.

- Provider: the OpenFeature-compatible component registered by applications.
- Flag snapshot: validated local configuration loaded from file input.
- Env override: environment-provided value that can intentionally override file state.
- Evaluation context: caller-provided targeting attributes; audit output must redact it by default.
- Targeting key: stable input used for deterministic percentage bucketing.
- Evaluation reason: machine-readable explanation for how a flag value was chosen.
- Audit event: JSON Lines record of evaluation metadata, source, reason, and replay-safe context summary.
- Replay fixture: captured snapshot plus sanitized inputs used to prove deterministic behavior.

## Runtime Flow

Flag evaluation moves from provider registration to snapshot load, optional env override,
type-safe resolution, reason generation, redacted audit output, and optional replay.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: evaluation context and targeting keys are sensitive by default.
- Operability: reason and audit events must let an operator explain why a value was returned.
- Compatibility: domain field names and reason taxonomy are public contract candidates.
