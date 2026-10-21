# P2 operations and integrity delivery

Owner: 0disoft
Status: implementation in progress, local main only; no publication authorized.

## Delivery order and acceptance

The accepted P2 task extends the embedded provider without adding a hosted control
plane, database, dashboard, or automatic background worker. Deliver and validate
each slice separately; retain earlier incomplete slices before starting new work.

1. Operational status: immutable privacy-safe status, successful unchanged refreshes,
   failed refreshes, optional age threshold and audit pending/failure/drop visibility.
   Rejected input preserves the active snapshot. External file-loader failures can
   be reported explicitly without retaining exception messages or paths.
2. Audit failure observation and policy: preserve best-effort default; distinguish
   waiting from delivery, bound optional waiting, expose failures and queue loss.
   Optional OpenTelemetry metrics record bounded reason/source/error categories,
   latency and queue state without user attributes, values or flag-key labels.
   The adapter does not install exporters or configure a global SDK.
3. HTTPS snapshots: caller-triggered refresh, ETag, bounded bytes/time/retries,
   serialized application and last-good fallback. Evaluation never performs network
   I/O. A rejected snapshot must not advance the committed ETag.
4. Signed delivery and persistent recovery: pinned trust keys with rotation,
   signed version/expiry/content, replay and downgrade rejection, atomic application,
   verified last-good recovery across process restart, bounded history and explicit
   rollback. Rollback must retain provenance and remain auditable.
5. GitOps recipe: validate and deliver snapshot artifacts, describe history and
   rollback using the actual source/recovery APIs without provisioning infrastructure.
6. Audit integrity: chain and verification tools, explicit rotation, concurrent
   writer and crash boundaries, and trusted external checkpoints. An unanchored
   hash chain does not establish authenticity or prove absence of full rewrite
   or tail truncation.

HMAC subject identifiers, S3/R2-specific clients, scheduled automatic rollouts,
other runtimes and independent adoption remain P3, not substitutes for P2.

## Completion evidence

Record implementation, focused verification, packaged consumer checks and commit
references here as slices finish. Local evidence does not prove Linux/macOS hosted
compatibility, remote issue closure or a public release. Preserve current Node
22/24 and v1 snapshot behavior. Advance the unpublished 2.0 prerelease and reviewed
API baseline for public contract changes.

No push, tag, release, remote branch update or hosted run is part of this task.

### Operational status completed locally

Commit f8cb6af / alpha.4 adds the observable provider interfaces and
`operational-status.md` contract.
Rejected updates preserve the active state; repeated identical updates renew
freshness; external failures and audit pending/failed/resolved calls are visible
without exception data. Sink queue counters are copied and validated separately
from provider acknowledgments. No evaluation-time status I/O or timer is added.

`check`, `contract`, format and lint passed on Windows Node 24.14.0. Package tests:
249 passed, 5 existing platform skips. Coverage: 93.75% statements, 91.18% branches,
99.12% functions, 94.31% lines. Reviewed API: 65 exports, 19 runtime values.
The 120,552-byte alpha.4 tarball passed ESM/CJS runtime status checks, legacy v1
evaluation, targeting, replay and CLI, TypeScript 5.9.3 full library validation and
7.0.2 consumer surface validation. The latter retains the documented SDK skipLibCheck
boundary. Hosted Linux/macOS verification is deferred because no push is authorized.

### Audit failure policy completed locally

Alpha.5 preserves default best effort and adds opt-in `returnDefault`, confirmed
sink writes and bounded asynchronous waiting. File confirmation rejects a full
queue even if ordinary writes use dropNewest. Pending writes remain visible after
timeout; eventual settlement and timeout counts are independent. The contract in
`audit-failure-policy.md` explicitly separates candidate evaluation, SDK response,
application enforcement and storage durability.

`check`, `contract`, format and lint passed on Windows Node 24.14.0. Node 22.23.3
also passed the full package suite: each runtime passed 262 tests with 5 existing
platform skips. Coverage: 93.94% statements, 91.54% branches, 99.15% functions,
94.49% lines. The reviewed API has 66 exports and 19 runtime values. The actual
OpenFeature SDK failure/default flow, file append/overflow, asynchronous timeout,
late rejection and unchanged legacy defaults are covered.

The 124,287-byte alpha.5 tarball passed ESM/CJS runtime failure policy checks and
TypeScript 5.9.3 full library / 7.0.2 consumer surface validation, including typed
status, confirmation options and timeout counters. No dependency, DB, runner,
repository hygiene policy or remote state changed. Hosted Linux/macOS evidence
remains deferred; no push is authorized.

### OpenTelemetry adapter completed locally

Alpha.6 adds the optional caller-owned Meter adapter and bounded, privacy-safe
evaluation counter/error counter/duration histogram plus operational gauge.
Status collection deduplicates shared sink identity, observes asynchronous changes
without new evaluations and unregisters the callback after the last provider closes.
The pure evaluator and uninstrumented provider do not acquire telemetry clock reads,
timers, exporters, global registration or network work.

`check`, `contract`, format, lint and dependency audit passed. Audit: zero
advisories. Windows Node 24.14.0 and 22.23.3 each passed 266 package tests with 5
existing platform skips. Coverage: 94.27% statements, 91.80% branches,
99.18% functions, 94.78% lines. Real API 1.9.1 / SDK 2.12.0 Meter assignability
and manual-reader collection prove privacy, errors, histogram, shared-sink
deduplication and callback lifecycle. Faulty telemetry cannot change results or
replace a flush error; audit timeouts measure the final error and blocking duration.

The 131,629-byte alpha.6 tarball passed ESM/CJS metrics recording/cleanup and
existing runtime/CLI checks with TypeScript 5.9.3 full-library and 7.0.2 consumer
surface checks. The API baseline has 71 exports, 20 runtime values. Telemetry
dependencies are development-only and retain stable major ranges in declaration
and lockfile. Fresh API 1.10 / SDK 3 failed the release-age check, so the selected
aged versions passed without any policy exception or workspace policy change.
No DB, runner, runtime dependency or remote state changed. Hosted Linux/macOS
verification remains deferred because no push is authorized.

### Caller-triggered HTTPS delivery completed locally

Alpha.7 adds the native HTTPS source interface and coalescing snapshot refresher.
TLS verification stays enabled, redirects are rejected, stream/header sizes and
whole-attempt deadlines are bounded, retries are finite and cancellation covers
I/O/backoff. ETags commit only after validated application. Invalid responses,
application rejection, asynchronous external updates and reentrant configuration
callbacks cannot attach a new validator to the wrong snapshot. Existing last-good
evaluation stays local; no automatic scheduler or background worker is added.

`check`, `contract`, format and lint passed. Windows Node 24.14.0 and 22.23.3 each
passed 289 package tests with 5 existing platform skips. Coverage: 94.70% statements,
92.41% branches, 99.23% functions, 95.27% lines. Tests use a real ephemeral TLS
certificate and loopback HTTPS service: trust failure, ETag 200/304, status/socket
retry, stream/length limits, header/body stalls, cancellation/backoff, validation,
coalescing, offline evaluation and failed/reentrant apply/cache behavior.
OpenSSL is required only for generating those ephemeral test artifacts.

The 145,058-byte alpha.7 tarball passed ESM/CJS source/refresher and existing runtime
checks plus TypeScript 5.9.3 full-library and 7.0.2 consumer-surface checks.
The API baseline has 80 exports, 22 runtime values. Public API, migration, SDK and
threat-model contracts point to `https-snapshots.md`. No runtime/development
dependency, DB, runner or repository hygiene policy changed. Hosted Linux/macOS
verification remains deferred because no push is authorized.

### Signed delivery and process-local continuity completed locally

Alpha.8 adds native Ed25519 signing and pinned public-key verification under a
restricted compact-JWS profile. It uses the fully-specified RFC 9864 algorithm
identifier, not deprecated polymorphic EdDSA. Bounded authenticated claims cover
audience, sequence, issuance/expiry and snapshot. Payload/schema parsing follows
signature verification. Strict expiry, maximum age/lifetime, bootstrap floor,
previous sequence/artifact continuity and explicit out-of-band rotation are enforced.

The refresher verifies 200 content and revalidates cached signatures on 304;
failed signature/application does not advance provenance/ETag/replay state.
Frozen provenance links to current semantic snapshot hashes and existing audit
records. That is snapshot-level linkage: distinct signed artifacts of identical
configuration are not yet individually identified in each evaluation's audit event.
Active last-good evaluations remain local after expiry/fetch failure.

`check`, `contract`, format and lint passed. Windows Node 24.14.0 and 22.23.3 each
passed 316 package tests with 5 existing platform skips. Coverage: 94.85% statements,
92.81% branches, 99.28% functions, 95.61% lines. Evidence covers independent native
JWS generation/verification, real TLS download, corruption/algorithm/key/audience
substitution, unknown headers, temporal/sequence limits, key capture/rotation,
equivocation/replay, signed-304 expiry, failed application continuity and audit hash
linkage. All keys are ephemeral real generated keys, not committed private fixtures.

The 157,095-byte alpha.8 tarball passed ESM/CJS signer/verifier/refresher/provenance
and existing runtime/CLI contracts, TypeScript 5.9.3 full-library validation and
7.0.2 consumer-surface validation. Reviewed API: 87 exports, 24 runtime values.
Public API, migration, SDK, ADR 0014 and threat-model contracts name
`signed-snapshots.md`. No dependency, DB, runner or repository hygiene policy changed.
Hosted Linux/macOS verification remains deferred because no push is authorized.

Remaining, in order: persistent verified last-good recovery, durable replay floor,
bounded history and explicit rollback, with exact signed-artifact audit linkage;
GitOps recipe; audit chain/checkpoint verification. Process-local provenance must
not be claimed as restart protection. Preserve this remaining scope in later slices.
