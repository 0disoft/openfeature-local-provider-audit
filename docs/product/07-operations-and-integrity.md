# P2 operations and integrity delivery

Owner: 0disoft
Status: all six P2 slices locally implemented and accepted on main; unpublished.

Current acceptance: `docs/testing/p2-acceptance.md` maps every item below to the
inspected source and behavioral evidence. The final acceptance entry at the end
owns current results. Earlier entries are historical: their remaining-work lists
describe what was outstanding at that slice, not the current backlog.

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
bounded history and explicit rollback; GitOps recipe; audit chain/checkpoint
verification. Exact signed-artifact linkage is completed in the following slice. Process-local provenance must
not be claimed as restart protection. Preserve this remaining scope in later slices.


### Exact signed-artifact evaluation linkage completed locally

Commit 2151be2 / alpha.9 captures optional validated, whitelisted, frozen provenance atomically with
provider state and each evaluation audit event. Re-signed identical configurations
retain distinct artifact identities; asynchronous audit settlement keeps its original
release. Unsigned equal-hash updates clear provenance. Provenance-only changes do
not emit flag-change events or add telemetry labels/signature work to evaluation.
Metadata supplied directly by callers is asserted origin, not signature proof.

Signed refresh seeds continuity from initial provider provenance, checks active
higher sequence and detects artifact replacement during fetch/application, including
equal-hash replacement. ETag/provenance publication requires matching active artifact
identity. Invalid metadata preserves the prior provider state and records failure.
The contract source is `signed-snapshots.md`, with matching audit/status/API/SDK and
migration docs. The staged version is unpublished `2.0.0-alpha.9`.

`check`, `contract`, format, lint and diff whitespace checks passed. Windows
Node 24.14.0 and 22.23.3 each passed 321 package tests with 5 existing platform
skips. Coverage: 94.97% statements, 93.06% branches, 99.28% functions, 95.71% lines.
The reviewed API remains 87 exports / 24 runtime values with additive optional
fields and update argument. The 161,365-byte alpha.9 tarball passed ESM/CJS
artifact audit/status/unsigned-clearing checks and TypeScript 5.9.3 full-library /
7.0.2 consumer-surface checks, including typed provenance options and events.
No dependency, DB, runner or repository hygiene policy changed. Linux/macOS hosted
verification and publication remain deferred because push is not authorized.

Remaining scope is unchanged: persistent verified last-good recovery, durable replay
floor, bounded history and explicit higher-sequence rollback; GitOps recipe; audit
hash chain, verifier and trusted external checkpoints with explicit rotation,
concurrent-writer and crash boundaries. No restart protection is claimed yet.


### Standalone signed storage and restart recovery completed locally

Commit aaecb82 / alpha.10 adds the bounded atomic `createFileSnapshotStore` journal, native signature
re-verification, retained newest-first history and higher-sequence signed rollback.
Recovered fresh `current` is separate from authenticated historical `floor`/entries:
expired or below-current-policy artifacts cannot silently reactivate. Explicit
`SnapshotRefresherOptions.previous` seeds replay continuity even with an unsigned
safe bootstrap. A separate real Node process recovers the exact artifact identity
and evaluates the restored configuration.

Commits capture input bytes, recheck the durable floor under an exclusive owner
lock, flush a private temporary file and rename atomically. POSIX also syncs the
parent; Windows power-loss durability remains filesystem-dependent. Invalid
artifacts, corruption, size limits, hard links and failed rename preserve the prior
journal. Abandoned locks require stopped-owner recovery; whole-file deletion/older
backup restore requires an external trusted floor. Retired older history keys never
prevent a still-trusted head from recovery, and unverifiable heads never fall back.
The authoritative contract is `docs/library/snapshot-recovery.md`; API, SDK,
migration, signed delivery, threat model and ADR 0014 point to that boundary.

`check`, `contract`, format, lint and diff whitespace checks passed. Windows Node
24.14.0 and 22.23.3 each passed 333 package tests with 6 platform skips (the existing
5 plus the new POSIX-only permissions/symlink test). Coverage: 94.60% statements,
92.72% branches, 99.32% functions, 95.53% lines. The 172,286-byte alpha.10 tarball
passed ESM/CJS store/recovery and existing runtime/CLI contracts, TypeScript 5.9.3
full-library and 7.0.2 consumer-surface checks. Reviewed API: 91 exports / 25 runtime
values. No dependency, DB, runner or repository hygiene policy changed. Hosted
Linux/macOS verification remains deferred because no push is authorized.

Next, before claiming P2 durable delivery complete: integrate persistence with
refresher/provider application, including rejected application, concurrent/reentrant
replacement, cancellation, persistence errors and ETag/provenance commit boundaries.
The standalone store does not claim atomic coordination with independent provider
updates. Then complete the GitOps recipe and audit hash chain/verifier/checkpoints
with rotation, concurrent-writer and crash boundaries. Preserve the full P2 scope.


### Durable refresh and provider activation completed locally

Commit f66ddda / alpha.11 adds optional signed-refresher `store` integration and the optional
provider `prepareSnapshot` / `SnapshotUpdateTransaction` capability. Each refresh
reloads authenticated durable continuity before fetching. Preparation validates and
reserves provider mutation while evaluations/audit keep the old snapshot/origin.
Store acceptance precedes atomic activation and configuration event delivery;
post-storage freshness validation prevents an artifact expiring during I/O from
being activated. Concurrent direct updates/preparations reject while reserved.

Validation failure never persists. Failed or ambiguous storage cancels preparation,
preserves active state/freshness/source ETag and is counted once as `persist`.
The next refresh reads the durable floor again. Matching acknowledgment advances
accepted continuity before callbacks; later reentrant replacement or close cannot
roll back already accepted disk state. ETag/source provenance only commit with
matching active contents. Close before storage starts prevents the commit; close
after it starts drains that operation and prevents activation. Custom transactions
must provide idempotent nonthrowing cancellation and honor the reservation contract.
The authoritative boundary is `docs/library/snapshot-recovery.md` and matching
signed/HTTPS/API/SDK/migration/threat-model/ADR contracts.

`check`, `contract`, format, lint and diff whitespace checks passed. Windows Node
24.14.0 and 22.23.3 each passed 345 package tests with 6 existing platform skips.
Coverage: 94.37% statements, 92.52% branches, 99.34% functions, 95.35% lines.
Tests cover gated I/O, old/new evaluation audit identity, mutation reservation,
preparation rejection, persistence failure/ambiguous success, close on either
owner, expiration during storage, post-activation replacement, floor recovery,
ETag 304, wrong acknowledgments and custom-store buffer mutation. The real ephemeral
TLS test now downloads/verifies/persists/activates and recovers with a fresh store
and provider. Prior independent-process restart coverage remains in place.

The 176,775-byte alpha.11 tarball passed ESM/CJS integrated durable refresh/recovery
and existing runtime/CLI contracts, TypeScript 5.9.3 full-library and 7.0.2 consumer
surface checks, including transaction/store option typing. Reviewed API: 92 exports /
25 runtime values. No dependency, DB, runner or repository hygiene policy changed.
Hosted Linux/macOS checks remain deferred because no push is authorized.

Remaining P2, in order: GitOps recipe using the actual signing/verification/store/
refresher/history APIs; audit hash chain, verification tool and trusted external
checkpoints with explicit rotation, concurrent-writer and crash boundaries. Final
completion must audit the whole P2 acceptance list, not only these latest slices.
No push, tag, release or remote workflow is authorized. P3 remains separate.


### Executable GitOps recipe completed locally

Commit 5755489 / alpha.12 adds `docs/library/gitops-snapshots.md` and executable SDK composition in
`examples/node-basic/src/gitops.ts`: native JSON/YAML validation/signing, explicit
first-installation authorization, public-key-only durable HTTPS consumer recovery,
and higher-sequence rollback from authenticated retained history. The recipe keeps
Git review, publisher sequence/signing, existing-origin atomic promotion and
application shutdown/storage ownership explicit. No origin, secret store, CI
workflow or external uploader is provisioned. Publisher Git/artifact manifests are
caller-owned evidence and are not misrepresented as signature-bound Git claims.

The opt-in configured `smoke:gitops` command executes the actual composition through
real ephemeral Ed25519 keys, loopback TLS/OpenFeature SDK, filesystem recovery and
redacted file audit. Windows Node 24.14.0 and 22.23.3 both proved releases 1/2/3,
one ETag 304, restored rollback contents, fresh-instance recovery without a fetch,
two rejected stale/corrupt updates, ten evaluations without network and 15 audit
records linked to accepted origins. Signing/TLS keys and artifacts are temporary;
cleanup closes the SDK/server and removes them even if earlier cleanup fails.
OpenSSL key generation is bounded and no private fixtures or credentials are tracked.

`check`, `contract`, targeted recipe smoke, typecheck, format, lint and diff whitespace
checks passed. The package suite on Windows Node 24 passed 345 tests with 6 existing
platform skips; coverage remains 94.37% statements / 92.52% branches / 99.34% functions /
95.35% lines. The 176,775-byte alpha.12 tarball passed ESM/CJS runtime/CLI and
TypeScript 5.9.3 full-library / 7.0.2 consumer-surface checks. The reviewed root API
remains unchanged at 92 exports / 25 runtime values. Runner change: one optional
local smoke intent, not another hosted workflow. No DB, dependency, repository
hygiene policy or remote state changed. Hosted Linux/macOS and production-origin
upload/promotion remain unverified; no remote publication is authorized.

Remaining P2: audit hash chain, verification tooling and trusted external checkpoints,
with explicit rotation, concurrent-writer and crash boundaries; then requirement-by-
requirement completion audit of every P2 slice. A valid unanchored hash chain cannot
prove authenticity, absence of whole-file rewrite or tail truncation. Retain that
boundary and keep the deferred P3 work separate. No push, tag or release.


### Audit chain primitives and streaming verification completed locally

Alpha.13 adds domain-separated native SHA-256 chain/checkpoint primitives and
strict redacted-event capture. Number/hash continuity detects modification, gaps,
reorder and duplication. Explicit prefix/head checkpoints bound suffix and exact-tip
claims; absence of a trusted external head does not claim tail/whole-log protection.
Captured fields/arrays/provenance are immutable; unknown/raw fields and getters are
rejected. Canonical semantics, ECMAScript duplicate-member behavior and byte/record
limits are explicit in `docs/library/audit-chain.md` and API/SDK/migration/security
contracts. No custom cryptographic primitive or signing identity is implied.

Read-only `audit-verify` streams ordered UTF-8 JSON Lines from bounded no-follow
regular-file handles, handles split multibyte sequences/CRLF, rejects partial final
records and enforces total/per-record/count/file limits. Output is a checkpoint-only
summary, with generic failures that do not echo records or paths. Independent native
hash/canonical-byte tests cover the format; CLI tests cover suffix/head anchors,
invalid input, Unicode chunking and limit behavior.

`check`, `contract`, typecheck, format, lint and diff whitespace checks passed.
Windows Node 24.14.0 and 22.23.3 each passed 352 package tests with 6 existing platform
skips. The actual alpha.13 tarball passed ESM/CJS chain operations and its real
packaged `audit-verify` CLI with a head checkpoint, plus existing runtime/CLI checks,
TypeScript 5.9.3 full-library and 7.0.2 consumer-surface validation. Reviewed API:
101 exports / 29 runtime values. No dependency, DB, runner, repository hygiene
policy or remote state changed. Hosted Linux/macOS remain unverified without push.

Remaining P2: integrate chained writes into the file sink under the existing path/
process coordination, preserve sequence/hash over rotation and retained prefixes,
reject incompatible modes, define durable checkpoint export and crash/partial-append
recovery, and verify cooperating concurrent writers. The plain file sink is unchanged
and does not yet emit chain envelopes. Then audit the entire P2 acceptance list.
External checkpoint trust/storage remains operator-owned. No push, tag or release.

### Segmented chained audit storage completed locally

Commit c8cca9d / alpha.14 adds the optional `createChainedFileAuditSink` without changing the plain
file format. Shared bounded queues and mandatory owner locks serialize cooperating
writers, including independent processes. Stable segment names and an atomically
replaced manifest preserve sequence/hash across retention. Data is flushed before
metadata commits; rotation commits retained history before removing old segments.
Complete unacknowledged tails and rotation orphans are verified and adopted; partial
tails, missing/truncated committed files and lost manifests fail closed and preserve
evidence. Checkpoint export drains, locks and fully verifies retained history.

Authoritative contracts are `docs/library/audit-chain.md`, public API/SDK, migration
and threat-model documents. External checkpoint authentication/retention and consistent
export copies remain operator-owned. Caller retries can duplicate accepted events;
abandoned locks are not stolen. Windows ACLs and power-loss behavior remain storage
boundaries, not guarantees inferred from POSIX directory synchronization.

`check`, `contract`, format, lint and diff whitespace checks passed.
Windows Node 24.14.0 and 22.23.3 each passed 359 package tests with 6 existing platform
skips. Focused cases cover actual two-process writes, retention, immutable capture,
large Unicode records, restart, complete-tail/orphan recovery, injected metadata
failure, partial/truncated data, unsafe modes and queue/lock rejection. Coverage:
93.84% statements, 91.80% branches, 99.43% functions, 95.47% lines.
The 218,131-byte alpha.14 tarball passed ESM/CJS chained storage/checkpoint use,
existing runtime/CLI checks and TypeScript 5.9.3 full-library / 7.0.2 consumer-surface
checks. Reviewed API: 105 exports / 30 runtime values. The release-readiness queue
checks now inspect the extracted shared queue source. No dependency, DB, runner,
repository hygiene policy or remote state changed.

Remaining P2: audit every acceptance item above against actual implementation and
evidence, reconcile stale scope/status descriptions and record any concrete gaps.
Hosted Linux/macOS/current-source CI and remote issue/PR reconciliation remain
unverified without an authorized push. P3 stays separate. No push, tag or release.

### Full P2 acceptance completed locally

The final audit checked all six numbered delivery items against actual source,
test assertions, SDK behavior and packed-consumer results. The matrix in
`docs/testing/p2-acceptance.md` covers status/freshness/privacy, audit counters and
failure policy, OTel lifecycle/cardinality, bounded HTTPS/ETag/last-good behavior,
signature/trust/time/sequence rules, exact audit origin, durable atomic activation,
restart/history/rollback, executable GitOps and anchored segmented audit integrity.
No accepted local P2 implementation remains open.

The audit added one missing integration proof: a real signed OpenFeature SDK
evaluation writes from a non-genesis trusted checkpoint, retains exact provenance
without raw user data, verifies its output through `audit-verify`, then returns the
caller's default with GENERAL error after a partial append. The original evidence
is preserved, the failed write is observable and checkpoint export fails closed.
No runtime code, API, dependency, version or storage format changed in this audit.

Fresh `check`, `contract`, `smoke:gitops`, format, lint and diff whitespace checks
passed. Windows Node 24.14.0 and 22.23.3 each passed 360 package tests with 6 existing
platform skips. Coverage remains 93.84% statements / 91.80% branches / 99.43%
functions / 95.47% lines. Tool checks and the reviewed 105-export / 30-value API
baseline passed. The actual 218,131-byte alpha.14 tarball passed ESM/CJS runtime,
typed exports, chain sink and packaged CLI checks, TypeScript 5.9.3 full-library
and 7.0.2 consumer-surface validation. The latter retains the documented SDK
skipLibCheck boundary, not strict TypeScript 7 library compatibility.

The GitOps smoke again proved releases 1/2/3, one ETag 304, higher-sequence restored
contents, fresh consumer recovery without fetch, two rejected stale/corrupt updates,
ten evaluations without network and fifteen redacted audit records. Old migration
pending-slice descriptions and roadmap/P0-P1 status were reconciled. The GitOps
contract now distinguishes snapshot lookup in memory from configured audit disk I/O.
No DB, runner/workflow, hygiene policy or remote state changed.

Remaining work is outside accepted local P2: hosted Linux/macOS/current-source CI,
Node 26 canary, remote issue/PR reconciliation and public release evidence require
separate authorization. Operators own trusted external checkpoints, origin promotion,
sequence allocation and storage recovery policy. HMAC identifiers, S3/R2 clients,
automatic rollout schedules, other runtimes and independent adoption remain P3.
These boundaries are documented, not claimed as completed operations. No push, tag,
deployment or publication was performed or authorized.
