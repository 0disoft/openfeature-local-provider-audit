# Threat Model

Status: Draft
Owner: 0disoft

## Trust Boundaries

- Flag files are caller-owned local input and may be malformed or stale.
- Environment overrides are caller-owned process input and may be mistyped.
- Evaluation context may contain personal or security-sensitive data.
- Audit sinks may fail or write to locations with different retention policies.
- Audit file sink paths are trusted local configuration, not end-user input.
- Replay fixtures are public-test artifacts and must be synthetic.

## Non-Goals

- Authentication.
- Authorization.
- Tenant enforcement.
- Hosted secret management.
- Remote flag management.

## Required Controls

- Validate flag snapshots before accepting them.
- Reject oversized local snapshot files before parsing.
- Make override parse failures visible.
- Reject oversized explicit JSON overrides before parsing.
- Return caller defaults with error reason metadata on runtime evaluation failure.
- Redact audit output by default.
- Keep audit failure behavior separate from value resolution behavior.
- Keep audit serialization redacted before sink writes.
- Catch provider audit sink write failures so local I/O failures cannot change resolved
  values in the current implementation.
- Keep provider audit writes non-blocking by default so slow local I/O does not delay
  resolved values.
- Provide an explicit flush path for short-lived local processes that need to drain
  pending audit writes before exit.
- Provide an optional bounded queue for local audit sinks so high-pressure writers can
  reject or drop newest audit writes instead of growing memory without a caller-selected
  limit.
- Bound local file growth with optional size-based rotation and retained rotated file
  count.
- Coordinate shared local audit files with optional advisory lock files when multiple
  cooperating processes use the same sink path.
- Bind advisory lock release to the recorded owner token so a writer whose stale lock
  was replaced cannot remove the replacement owner's lock.
- Keep audit file paths out of tenant, request, and untrusted environment control unless
  a wrapper validates and confines them first.

## Review Blockers

- Feature flags are documented as access control.
- Provider code accepts credentials for local evaluation.
- Audit output becomes a personal-data collection point.
- Snapshot or override parsing accepts unbounded local input.
- Audit rotation touches paths outside the configured audit file and its numbered
  rotated siblings.
- Multi-process audit writers assume locking without enabling or honoring the advisory
  lock contract.
- Advisory file locking is presented as a distributed lock or as protection against
  hostile writers that can modify the lock path.
