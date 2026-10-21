# Threat Model

Status: Draft
Owner: 0disoft

## Trust Boundaries

- Flag files are caller-owned local input and may be malformed or stale.
- Environment overrides are caller-owned process input and may be mistyped.
- Evaluation context may contain personal or security-sensitive data.
- Audit sinks may fail or write to locations with different retention policies.
- Optional HTTPS source URL and CA are trusted operator configuration. No context-
  supplied URLs, redirect following or TLS verification bypass is supported.
- Audit file sink paths are trusted local configuration, not end-user input.
- Replay fixtures are public-test artifacts and must be synthetic.

## Non-Goals

- Authentication.
- Authorization.
- Tenant enforcement.
- Hosted secret management.
- Remote flag management.

Caller-triggered HTTPS snapshot delivery is accepted post-MVP under ADR 0014.
Transport verifies TLS and bounds bytes/time/retries, but is not a management
server or a signed content/provenance guarantee. The active last good state is
preserved on failed fetch/parse/apply. ETags commit after apply, and asynchronous
responses cannot overwrite a different current provider hash. Network errors do
not expose source URLs, response bodies or raw causes. Protect presigned queries
in caller-owned configuration and any external network instrumentation.

Optional signed delivery pins Ed25519 public keys and expected audience, bounds
artifact size/age/lifetime and checks previous committed sequence/artifact identity.
The signing helper accepts a caller-owned private KeyObject and never reads secrets.
Untrusted headers cannot choose another algorithm or discover keys. Expired 304
responses do not renew freshness. Publisher key security, trusted clocks/floors and
out-of-band key rotation remain caller responsibilities. Replay continuity is
process-local unless an authenticated durable floor is recovered explicitly.
The optional standalone file store bounds and re-verifies retained artifacts, exposes
expired history separately from fresh activation and seeds refresh through `previous`.
It trusts the full local directory chain, clock and pinned keys. Restoring/deleting an
entire journal requires an external trusted minimum sequence; file storage is not a
hardware monotonic counter. Interrupted-writer locks require stopped-owner recovery.
See `docs/library/snapshot-recovery.md` for ordered durable acceptance and atomic
provider activation. Prepared updates reserve mutation while old evaluations remain
available; close/reentrant callbacks cannot undo an already accepted durable floor. JWS does not encrypt configuration.

Optional audit chain verification authenticates consecutive hash relationships,
not a writer identity. Trusted external prefix/head checkpoints are necessary to
bound claims about retention, whole-file rewrite and tail truncation. Checkpoints
beside a writable log are not independent trust. Strict bounded captures reject
unknown fields/getters and preserve explicit context-name disclosure policy. See
`docs/library/audit-chain.md`; the opt-in segmented writer uses a dedicated
trusted directory, mandatory owner lock, data/manifest sync and verified recovery.
Partial committed history fails closed; plain file writers remain compatible.

## Required Controls

- Validate flag snapshots before accepting them.
- Read local snapshots from the same handle used for the initial size check and stop at
  the configured byte limit so replacement or growth cannot bypass the parse boundary.
- Make override parse failures visible.
- Reject oversized explicit JSON overrides before parsing.
- Return caller defaults with error reason metadata on runtime evaluation failure.
- Redact audit output by default.
- Keep audit failure behavior separate from value resolution behavior.
- Keep audit serialization redacted before sink writes.
- Catch provider audit sink write failures so local I/O failures cannot change resolved
  values under the default best-effort policy. The explicit 2.0 `returnDefault`
  policy requires confirmed writing and returns a safe caller default/error on
  failure or timeout. This is not authorization or enforcement of a business audit
  requirement; applications must inspect errors and refuse sensitive actions.
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
- Treat automatic stale-lock takeover as recovery convenience, not fencing. The path-based stale
  inspection and removal can race with lock replacement; strict multi-process audit integrity
  requires stale takeover to remain disabled and abandoned-lock recovery to have one external
  owner.
- Keep audit file paths out of tenant, request, and untrusted environment control unless
  a wrapper validates and confines them first.
- Create audit paths with private POSIX modes and reject unsafe final file types, link
  counts, ownership, and symbolic links before appending.
- Treat the complete audit directory chain as trusted configuration. POSIX no-follow open
  protects the final component; Windows deployments must use directory ACLs to prevent a
  local attacker from replacing the path between validation and open.

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
- Automatic stale-lock takeover is described as race-free or owner-fenced.
- A writable parent directory or Windows path is described as safe merely because the
  final component was checked before open.
