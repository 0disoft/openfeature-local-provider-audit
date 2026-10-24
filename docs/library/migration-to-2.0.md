# Migration to 2.0 (unpublished development prerelease)

Schema v1 remains supported. Its overrides, hashes, bucket algorithm, default return,
redaction and watcher behavior are preserved. Do not change existing snapshots merely
to upgrade the package. Schema v2 explicitly enables the new contract in
`flag-file-schema-v2.md` and ADR 0013.

The public snapshot version expands from `1` to `1 | 2`; reason unions include
`TARGETING_MATCH` and `DISABLED`. Exhaustive TypeScript switches and assignments to
the literal version `1` need review. This is deliberately a new major version,
currently a local `2.0.0-alpha.49` prerelease, not a public release or stability claim.
Keep a default branch in reason handlers or handle the new reasons explicitly.

Alpha.49 corrects the authoring schema for targeting rule variant references.
Existing names longer than 128 characters now pass the editor schema, matching
runtime validation. Rule IDs retain their 128-character limit; nonexistent variant
references still fail at runtime. No evaluator or public API signatures change.

Alpha.48 memoizes snapshot hashes only for captured, deeply frozen validator-owned
snapshots. Repeated explanations and direct audit-event creation avoid rehashing
unchanged configuration. Mutable or caller-frozen inputs still recompute hashes.
Hash format, evaluation results and public signatures remain unchanged.

Alpha.47 adds the read-only generate-types CLI for validated JSON/YAML snapshots.
Standalone declarations quote/sort keys and preserve broad declared value types
for environment overrides. No existing evaluator or SDK signatures change.

Alpha.46 adds offline v1/v2 JSON Schema exports and authoring guidance. Runtime
validation remains authoritative for semantic invariants. No evaluator behavior
or existing public TypeScript signatures change.

Alpha.45 adds opt-in compare percentage limits and exit3 for policy rejection.
Default differences still exit0; evaluation/input errors retain exit1 and usage
errors exit2. Optional --diagnostics emits only bounded error categories and a
zero-based request index, never raw requests, values, keys, paths or parse errors.
No public TypeScript signatures change.

Alpha.44 adds an optional-telemetry audit queue byte gauge (unit By) with pending
and bounded_capacity states. Shared sinks are counted once; item-unit states report
unknown/unbounded byte limits so a partial capacity is not mistaken for a total.
Zero byte observations clear previously collected finite values. Existing counts remain.
Both callbacks are released on close or partial registration failure. No signatures change.

Alpha.43 accepts inspection request flag keys longer than 256 characters, matching
the existing snapshot parser and evaluator. Nonempty-key, input byte/node/depth and
request-count limits remain. No existing key is rejected and public signatures stay.

Alpha.42 attempts S3 body and iterator cleanup once per acquired resource when
abort, timeout and finalization converge. Throwing or asynchronous cleanup remains
best effort and never replaces the request outcome. Late response bodies still get
their own cleanup attempt. Public signatures and transport retry policy are unchanged.

Alpha.41 captures the S3 SDK response ETag before asynchronous body consumption.
Client middleware reusing or mutating its response during streaming cannot associate
another version's validator with the delivered bytes and skip the next update. Missing
or invalid initial ETags remain absent; signatures, byte limits and retries are unchanged.

Alpha.40 captures custom source response status and ETag before verification,
persistence or provider callbacks. Later mutation of a reused response cannot attach
a different validator to the applied snapshot and skip a subsequent update. Malformed
ETags are discarded consistently with the built-in transports, leaving the next
request unconditional. Public signatures, content validation and replay rules remain.

Alpha.39 avoids repeatedly serializing identical object pairs in the offline compare
CLI. Equality booleans are cached locally through weak keys; evaluation runs for each
request, and serialized values are not retained. JSON equality, changed decision
counts, ordering, privacy, errors and public signatures remain unchanged.

Alpha.38 attempts all owned watcher cleanups when one release fails, including
polling plus native handles and the two macOS watchers. Compound setup/delivery
and cleanup failures retain the original cause in AggregateError; single errors
keep their identity. Repeated close does not retry ambiguous releases, and polling
startup cleanup no longer closes the macOS directory watcher twice. No signature,
reload ordering, event filtering or default polling behavior changes.

Alpha.37 preserves simultaneous snapshot file read/handle-validation and close
failures as AggregateError, with operation first, close second, and the original
operation as cause. Single failures retain their identity and no close retry is added.
This also covers CLI input readers; CLI output remains sanitized. Existing audit
cleanup semantics use the same internal helper. No public signatures change.

Alpha.36 rejects malformed UTF-8 bytes in file loads/reloads and shared CLI input
reads with PARSE_ERROR. Previously replacement characters could silently change
flag keys, values or request attributes. Repair/re-encode such files, or explicitly
select a supported legacy encoding for snapshot files when intentional. Valid UTF-8,
byte limits, BOM handling, public signatures and last-good watcher state are unchanged.

Alpha.35 validates watcher `debounceMs` as an integer in 0..2,147,483,647 before
opening native/polling resources or reading the initial file. Invalid settings now
reject with RangeError instead of Node silently clamping the delay, including
overflow to 1 ms. Omitted settings retain the 50 ms default; zero remains supported.
Valid settings, event ordering, polling policy and public signatures are unchanged.

Alpha.34 makes provider freshness independent of wall-clock adjustments. Optional
`staleAfterMs` now measures monotonic elapsed time from the last successful refresh,
including unchanged content; failures do not renew it. Status timestamps remain epoch
milliseconds, and evaluation behavior and public signatures are unchanged.

Alpha.26 privately indexes wide validated `in` condition arrays for repeated
membership evaluation. Only validator-owned frozen copies are indexed; direct
caller-provided arrays keep live strict-equality behavior, including after mutation.
Small arrays retain linear lookup. Indexes use weak keys, store configuration only,
and do not appear in snapshots, hashes, traces or exports. Duplicate/order semantics,
first matching rule, numeric/string distinction and all condition limits remain.
No migration action or public signature change is required, including for /core.

Alpha.25 prepares a lazy per-snapshot envVar index for local CLI inspection.
Simulation/comparison no longer scan all flags for each request's env mapping.
Each name maps to all referring flags, with original snapshot order, JSON override
precedence and per-flag parse errors preserved. Before/after indexes are separate,
and each request still parses its own values. Mutable direct API inputs retain the
ordinary uncached path; no public signature, hash, report or error contract changes.

Alpha.24 removes repeated whole-journal serialization while trimming snapshot
history to maxBytes. It retains the same newest contiguous prefix, duplicate/order
rules, JSON property order, UTF-8 bytes and trailing newline. Each examined artifact
is encoded once; processing stops at the first entry that cannot fit. Journal schema,
signature/replay verification, locks, write acknowledgment and recovery are unchanged.
No new public API is added.

Alpha.23 bounds file/chained sink queues by both 5,000 pending writes and 64 MiB
of pending event JSON Lines bytes by default. `maxQueueBytes` accepts a positive
safe integer or null; each null disables only its own bound. To restore the old
fully unbounded policy, explicitly set both maxQueueSize and maxQueueBytes to null.
Existing rejection/drop-newest and confirmed-write semantics apply to either bound.
Byte reservations include active writes and release only after actual settlement,
including failures. Optional FileAuditSinkStats.pendingBytes / maxQueueBytes are
also projected into provider status; custom sinks can keep their old stats shape.
The byte budget counts captured event JSON in UTF-8 plus its newline, not JS heap,
Promise overhead, temporary serialization or chain-envelope/disk bytes. Coordinate
aggregate budgets when creating multiple sinks. No event ordering, hash-chain,
locking, acknowledgment or crash-recovery contract changes.

Alpha.22 adds a shared refresh `timeoutMs` (default 30,000 ms; integer
1..2,147,483,647). Existing call signatures remain valid, but previously unlimited
custom source/store waits now reject at the deadline. Increase the limit explicitly
for slower delivery. Cancellation is cooperative: one owner is retained until the
actual outstanding I/O settles, and repeated refresh calls share the rejected result
while it remains outstanding. A timed-out commit has an unknown outcome, is never
automatically retried, and keeps its provider reservation until actual settlement.
Late matching acceptance advances the replay floor without activating or caching
that delivery. Reconcile through explicit recovery before further writes.
`SignedSnapshotStore.load({ signal }?)` adds optional read cancellation; existing
zero-argument implementations remain compatible. Optional `onFailure` receives
`{ kind, cause, timedOut }` for trusted operator diagnostics, including private raw
causes. Protect this callback as a sensitive logging boundary. Exceptions/rejected
promises from it are ignored. A late commit failure can generate a second diagnostic
after timeout, but the refresh failure counter increments only once. Public errors,
status and audit events retain their sanitized contracts.

Alpha.21 adds optional `totalTimeoutMs` (1..320,000 ms) to HTTPS/S3 sources.
The default total budget equals the former maximum attempts/backoff envelope;
backoff now uses full jitter. Each attempt is capped to the remaining monotonic
budget. Only transport reads retry; persistence and activation are never retried.
Underlying S3 clients must still use maxAttempts: 1 to avoid nested retries.

Alpha.20 bounds provider shutdown flushing to 5,000 ms by default; configure
`auditShutdownTimeoutMs` (1..2,147,483,647) with an audit sink for another limit.
Provider event handlers and metrics are released before waiting. Repeated close
calls share one result. A timeout rejects with `AUDIT_SINK_ERROR`; it neither
cancels pending I/O nor closes a shared sink. Late flush failures remain observed.
Remove `staleLockMs` from file sink settings: supplying it now throws rather than
risk deleting a live owner's lock. Stop all writers before abandoned-lock recovery.
Lock release attempts owned-marker cleanup even if handle close fails.

Alpha.19 adds optional `SnapshotRefresher.refresh({ signal })`. Existing no-argument
calls and return types are unchanged. A caller signal cancels that wait, not the
shared refresh; use `close()` to stop shared fetch/recovery waiting. Abort-ignoring
custom sources can no longer hold that wait open after close, though their own I/O
may continue. Already-started durable commits drain internally; alpha.22 bounds the caller wait.
Watcher `reload()` rejects from its own active `onSnapshot` callback instead of
deadlocking; unrelated callers and post-callback scheduled reloads still work.

Alpha.4 adds operational status. Provider factories now return
`ObservableLocalProvider` (still assignable to OpenFeature `Provider`).
Custom implementations of `ReloadableLocalProvider` must add `getStatus()` and
`reportRefreshFailure(kind)`. Existing constructor options and evaluation behavior
are unchanged; `staleAfterMs` is optional. See `operational-status.md`.

Alpha.5 adds optional audit failure policy and asynchronous wait limits. Defaults
are unchanged. Custom sinks only need the new optional `writeConfirmed` capability
when opting into `returnDefault`; ordinary `write` keeps its `Promise<void>` type
and overflow policy. Custom operational status implementations add the
`timedOutWrites` counter. See `audit-failure-policy.md` before selecting a safe
caller default or assuming any durability/business-enforcement guarantee.

Alpha.6 adds optional `metrics` and `createOpenTelemetryMetrics(meter)`; omit it
to retain uninstrumented operation. The structural `OpenTelemetryMeter` type keeps
telemetry packages out of consumer dependencies and declarations. Only development
tests install the real Apache-2.0 API 1 / metrics SDK 2 within stable major ranges.
The lockfile selects published versions past the repository's release-age policy;
fresh API 1.10 / SDK 3 were not allowed through an exception. No collector/exporter,
global SDK, timer or OpenTelemetry runtime dependency is installed by the adapter.
See `opentelemetry-metrics.md` for collection, labels and lifecycle.

Alpha.7 adds caller-triggered HTTPS delivery through `createHttpsSnapshotSource`
and `createSnapshotRefresher`, with the source/request/response/options/result
interfaces in `https-snapshots.md`. Existing local file/evaluation APIs are unchanged;
no evaluation performs a fetch and no automatic refresh is enabled. No runtime
dependency was added. Source transport failures use existing `PROVIDER_NOT_READY`;
the active last good provider remains available. Signing and durable recovery are
not claimed by this transport slice.

Alpha.8 adds optional signed JWS delivery, `signFlagSnapshot`,
`createSnapshotVerifier` and five signing/verification/provenance types.
`SnapshotRefresherOptions.verifier` opts in; ordinary JSON/YAML refresh is unchanged.
Custom `SnapshotRefresher` implementations add `getProvenance()`.
`SnapshotRefreshResult.provenance` is optional. Use native Ed25519 KeyObjects for
signing, pinned public keys for verification and current deployment-specific
audience/freshness policy. No JOSE or other runtime dependency is added. See
`signed-snapshots.md` before rotation, rollback or reconstructing process-local
replay state. Alpha.10/11 below add persistent restart recovery and durable refresh.
The protected algorithm identifier is fully specified `Ed25519` under RFC 9864;
the deprecated polymorphic `EdDSA` identifier is not accepted by this new profile.

Alpha.9 adds optional provenance to initial provider options, provider status,
audit events and audit event options, and an optional second `updateSnapshot`
argument. Existing one-argument calls remain valid and clear signed origin, even
for equal contents. Custom reloadable providers used by signed refreshers must
atomically expose the supplied provenance; otherwise refresh fails closed. These
fields validate metadata shape/hash, not signatures. Follow `signed-snapshots.md`.

Alpha.10 adds the optional standalone file snapshot store and three store/recovery
types. `SnapshotRefresherOptions.previous` restores an authenticated durable floor;
it requires a verifier and cannot contradict an equal-sequence initial origin.
`load()` exposes expired history only as historical evidence, with no fresh `current`.
Existing providers/refresher defaults perform no storage I/O. See
`snapshot-recovery.md` for bounds, storage trust and crash/lock recovery. Alpha.11
below adds coordination between persistence and active provider application.

Alpha.11 adds optional `SnapshotRefresherOptions.store`, provider capability
`prepareSnapshot` and `SnapshotUpdateTransaction`. Only durable refresh requires
this capability and a signed verifier; ordinary custom providers remain compatible.
Native providers reserve updates during storage while serving old evaluations.
Store acceptance precedes activation and is not undone by close or later application
callbacks. Failed preparation never persists; failed/ambiguous storage never activates
and a subsequent refresh reloads the floor. Post-storage expiry also blocks activation.
See `snapshot-recovery.md`; the existing no-store behavior is preserved.

Alpha.12 adds an executable SDK GitOps recipe and targeted `smoke:gitops` runner.
Package-root exports and existing consumer behavior are unchanged. See
`gitops-snapshots.md` for publisher ownership, first-start/recovery policy, history
rollback, public-key rotation and the local-only delivery proof.

Alpha.13 adds opt-in audit chain primitives and `audit-verify` without changing
plain AuditEvent/file sink output. Four helpers and five contract types capture
redacted events, verify consecutive links and compare explicit trusted checkpoints.
Unknown/accessor/raw fields are rejected. See `audit-chain.md` for canonical bytes,
bounds and authenticity/truncation limits. Alpha.14 below adds chained file writing
and rotation; ordinary sinks do not automatically acquire a chain.

Alpha.14 adds `createChainedFileAuditSink` and three options/checkpoint/sink types.
Its dedicated directory/manifest/segments are separate from the plain file format.
Mandatory advisory locking, bounded rejecting queues, atomic manifest retention,
fsynced records and full retained checkpoint verification define the opt-in contract.
Complete unacknowledged records can be adopted after interruption; partial data
fails closed. See `audit-chain.md` for recovery, external checkpoint trust and
filesystem durability. Existing plain sink queue behavior is shared unchanged.

Alpha.15 adds optional HMAC audit correlation through `createHmacAuditPseudonymizer`,
three contract types, `LocalProviderOptions.auditPseudonymizer`, event options
`pseudonymizer` and `AuditEvent.pseudonym`. Defaults stay uncorrelated and existing
chain bytes remain unchanged. When opting in, upgrade chain verification with the
writer: old alpha verifiers reject unknown pseudonym fields. See
`audit-pseudonyms.md` for key/scope isolation, rotation, Unicode limits and privacy.

Alpha.16 adds optional schema-v2 `schedule`, request `evaluationTime`, provider
`clock`, two contract types and schedule metadata on results/explanations/audit/
replay. Existing snapshot behavior is unchanged when schedule is absent. Pure
scheduled evaluation requires explicit time; providers default to Date.now and
never use a context-supplied clock. Upgrade chain verification alongside opt-in
writers. See `scheduled-rollout.md` before using stages, replay or clock rollback.

V2 `disabledVariant` outranks overrides, including malformed overrides. V1 has no
emergency field and keeps its old precedence. Targeting first-match order, missing
attribute behavior and conditional rollout fallback are explicit in the v2 contract.
`localProviderRuleId` in OpenFeature flag metadata is provider-owned when a rule is
selected; do not use that key for application metadata. Rule IDs must not be personal.

Strict app-version comparisons use runtime dependency `semver` (ISC license) within
major 7; `@types/semver` is development-only. It has no native component and performs
no I/O. Existing YAML remains the only other direct runtime dependency. This avoids
maintaining a second SemVer precedence implementation. New major dependency updates
require deliberate review. Audit the declaration and lockfile together.

Rollback: first deploy v1 configuration, then revert to the previous provider.
Older providers reject v2; they must never silently evaluate it as v1. No push,
tag, npm publication, or hosted compatibility result is implied by local verification.

Alpha.17 adds opt-in `createS3SnapshotSource`, `S3SnapshotClient` and
`S3SnapshotSourceOptions`. Callers own their SDK client, credentials and HTTPS
endpoint. No SDK runtime dependency or automatic I/O is introduced; existing
refresher/verifier/store composition is unchanged. See `s3-snapshots.md`.

Alpha.18 adds the deliberate `/core` subpath for synchronous evaluation and JSON
snapshot parsing with platform-neutral types. Root provider/file/audit/inspection
APIs remain Node-only. Native Node bucketing stays SHA-256 compatible with the
portable implementation; no request or schema migration is required. New packaged
core and bundled dependency notices increase artifact size. See `portable-core.md`;
non-Node support remains pending real runtime evidence.

Alpha.27 recovers bounded multi-record uncommitted audit suffixes atomically.
Upgrade all processes reading the same chain before enabling batched writes;
older readers cannot recover a multi-record suffix left by an interrupted batch.

Alpha.28 enables bounded coalescing of concurrent chained audit writes by default.
Set batchSize: 1 to retain singleton groups. Existing write/writeConfirmed/flush
signatures and chain schema/hash format are unchanged. A failed group may have a
durable prefix; all callers reject and no automatic retry occurs. See audit-chain.md.

Alpha.29 bounds best-effort blocking audit waits to 1,000 ms when auditTimeoutMs
is omitted. Previously that combination could wait forever. Set an explicit finite
limit for slower sinks. Candidate results remain unchanged under bestEffort;
returnDefault keeps its existing 1,000 ms deadline and default-on-failure policy.
Timeout does not cancel or retry storage; pending writes settle and count later.

Alpha.30 preserves simultaneous audit operation/cleanup failures as AggregateError
with the original cause, including initialization/close/owned-marker and metadata
publication/temporary-file failures. Callers inspecting raw plain-sink failures
should inspect cause/errors when multiple failures occur; single errors retain
identity. Optional chained sink onError receives raw trusted operator diagnostics;
public chained errors remain sanitized. Callback errors never replace storage
results and callbacks are not awaited. No automatic append or cleanup retry is added.

Alpha.31 prevents immediately resolved S3 byte iterators (including empty chunks)
from starving deadline and cancellation callbacks. No API or retry-policy change.

Alpha.32 makes large-record audit file framing linear in input bytes. Public
signatures, chain hashes and strict encoding/size/partial-record checks are unchanged.

Alpha.33 preserves compound snapshot recovery store failures in existing trusted
refresher onFailure diagnostics. Primary and cleanup failures remain ordered/nested
in AggregateError, while public load/commit/refresh errors remain sanitized. Handles
close once; owned cleanup is attempted even after close errors, without new retries.
Foreign or unverified lock identities remain untouched. Existing API and journal
format are unchanged; see snapshot-recovery.md for ambiguous accepted commits.
