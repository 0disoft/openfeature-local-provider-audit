# Threat Model

Status: Draft
Owner: 0disoft

## Trust Boundaries

- Flag files are caller-owned local input and may be malformed or stale.
- Environment overrides are caller-owned process input and may be mistyped.
- Evaluation context may contain personal or security-sensitive data.
- Audit sinks may fail or write to locations with different retention policies.
- Replay fixtures are public-test artifacts and must be synthetic.

## Non-Goals

- Authentication.
- Authorization.
- Tenant enforcement.
- Hosted secret management.
- Remote flag management.

## Required Controls

- Validate flag snapshots before accepting them.
- Make override parse failures visible.
- Return caller defaults with error reason metadata on runtime evaluation failure.
- Redact audit output by default.
- Keep audit failure behavior separate from value resolution behavior.
- Keep audit serialization redacted before sink writes.
- Catch provider audit sink write failures so local I/O failures cannot change resolved
  values in the current alpha implementation.
- Keep provider audit writes non-blocking by default so slow local I/O does not delay
  resolved values.
- Provide an explicit flush path for short-lived local processes that need to drain
  pending audit writes before exit.

## Review Blockers

- Feature flags are documented as access control.
- Provider code accepts credentials for local evaluation.
- Audit output becomes a personal-data collection point.
