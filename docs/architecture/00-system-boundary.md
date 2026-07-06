# System Boundary

Status: Draft

## Boundary

Owned:

- Local flag file schema and parser adapter boundary.
- Env override naming and precedence.
- Provider registration and evaluation behavior exposed to OpenFeature SDK users.
- Deterministic bucketing, evaluation reasons, redacted audit event schema, and replay fixtures.

Not owned:

- Hosted flag control plane, dashboard, remote config server, streaming updates, approval workflow, experiment analytics, or segment database.
- Application-specific flag definitions, rollout policy, or user targeting policy.

## Runtime Flow

Application code calls the OpenFeature evaluation API. The OpenFeature SDK delegates to
this provider. The provider resolves the flag from local snapshot state, env overrides,
and deterministic bucketing, then returns a value with reason metadata and writes a
redacted audit event when audit logging is enabled.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: context redaction is default-on for audit output.
- Operability: every nontrivial resolution path must be explainable through reason metadata.
- Compatibility: public behavior must be stable enough for CI replay fixtures.
