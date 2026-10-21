# P2 local acceptance audit

Date: 2026-10-21. Scope: ADR 0014 and all six numbered delivery items in
`docs/product/07-operations-and-integrity.md`. Version: unpublished
`2.0.0-alpha.14`. This audits actual source and behavioral assertions, not just
the existence of files or a green aggregate check.

## Requirement evidence

Source paths below are relative to `packages/local-provider/src/`; test paths
are relative to `packages/local-provider/test/`.

| Accepted requirement | Implementation inspected | Behavior proving the requirement |
| --- | --- | --- |
| Immutable private operational status; unchanged refresh versus changed contents; opt-in age | `provider/operational-state.ts`, `provider/local-provider.ts` | `provider/operational-status.test.ts`: frozen copies, clock boundaries, same-content refresh resets freshness without changing lastChangedAt |
| Rejected input preserves last good; explicit loader failure without exception retention | Same provider/state sources | Operational status tests reject schema 99, count validation/load separately, evaluate previous true value, reject unknown failure kinds |
| Audit pending/resolved/failed/drop/reject visibility | Operational state and `audit/queued-sink.ts` | Operational status tests settle concurrent writes and copy only documented counters; audit-event tests exercise reject/dropNewest, bounded failure causes and serialized flush |
| Best effort remains default; confirmed returnDefault; bounded asynchronous wait | `provider/audit-policy.ts`, provider write/resolve flow | `provider/audit-policy.test.ts`: real SDK returns default/GENERAL, invalid policies reject, full dropNewest queue rejects confirmed writes, late failure remains observable after timeout |
| Optional private OTel counts/latency/queue state; no global SDK/exporter | `metrics/opentelemetry.ts`, provider metrics lifecycle | `provider/metrics.test.ts`: actual Meter/MetricReader, bounded attributes without flag/user/hash labels, shared-sink deduplication, late collection and callback cleanup, final policy error and blocking latency |
| Caller-triggered HTTPS with ETag; bounded bytes/time/retries; TLS stays verified | `sources/https-source.ts` | `flags/https-source.test.ts`: real TLS, header/body deadlines, declared/chunked limits, finite retry counts, cancellation/backoff, rejected redirect/compression and certificate distrust |
| Serialized application, last-good fallback, rejected ETag never commits, no evaluation fetch | `sources/snapshot-refresher.ts` | HTTPS tests prove coalesced calls, 200/304, invalid/reentrant updates preserve validators, old values survive rejected content and request count stays unchanged during evaluation |
| Pinned signing keys and rotation; signature-bound content/version/expiry | `sources/signed-snapshot.ts` | `flags/signed-snapshot.test.ts`: independent native signatures, pinned PEM/KeyObjects and rotation/revocation, algorithm/header/domain substitution, corruption, time and schema limits |
| Replay/downgrade/equivocation rejection; auditable origin | Signed verifier, refresher and `flags/snapshot-provenance.ts` | Signed tests prove sequence/issuance floors, equal-sequence artifact conflict, expiry on 304, same-content distinct releases, atomic status/audit provenance and old-origin capture for queued evaluations |
| Atomic application follows durable acceptance; failures preserve active state | Refresher and provider `prepareSnapshot` reservation/transaction | `flags/durable-refresh.test.ts`: gated I/O serves/audits old origin, callback observes accepted origin, failed preparation never persists, failed/ambiguous storage never activates, close/expiry/reentrancy cannot lower accepted floor |
| Verified restart recovery, bounded history, explicit rollback | `sources/snapshot-store.ts` | `flags/snapshot-store.test.ts`: independent Node process recovery, expired authenticated floor without activation, corrupt head fails closed, retained count/byte bounds, higher-sequence rollback, wrong owner/link/lock and injected rename failure |
| Executable GitOps validation/signing/delivery/recovery/rollback; no infrastructure provisioned | `examples/node-basic/src/gitops.ts` | `smoke:gitops`: actual JSON/YAML, Ed25519, loopback TLS/OpenFeature, releases 1/2/3, one 304, restored contents, fresh consumer without fetch, stale/corrupt rejection, private audit origins and ten evaluations without network |
| Audit chain and read-only verification; explicit external trust | `audit/audit-chain.ts`, `audit/chain-event.ts`, `cli/audit-verification.ts` | `audit/audit-chain.test.ts`, `cli/audit-verification.test.ts`: independent canonical SHA-256, tamper/gap/reorder/duplication, unknown/raw/accessor rejection, supplied suffix/head anchors, tail-loss failure with expected head and bounded streaming UTF-8 |
| Rotation, cooperating concurrent writers, crash/partial-data recovery | `audit/chained-file-sink.ts`, `audit/chain-files.ts`, shared queue/lock | `audit/chained-file-sink.test.ts`: retained prefix/head, two actual Node writers, restart, complete unacknowledged tail/orphan adoption, rename fault, partial/truncated data preserved, missing manifest and unsafe modes reject |
| Confirmed SDK evaluation composes with signed origin and anchored storage | Provider, chain sink, verifier and CLI together | Chained sink SDK test starts from a non-genesis checkpoint, retains exact signed provenance, verifies exported data through CLI, then returns visible default/GENERAL after a partial append while preserving forensic bytes and observing failed write |
| Existing v1 and supported Node 22/24; reviewed public distribution | Package root/types, API baseline and `scripts/packed-smoke.mjs` | Full package suites retain v1 evaluation/override/bucketing/redaction/replay/watch coverage; actual tarball exercises ESM/CJS, SDK contracts, new chain sink, packaged CLI and typed exports |

## Validation and release boundary

The final audit records fresh command results in the P2 delivery record. Required
local gates are `check`, `contract`, format, lint, diff whitespace and the actual
GitOps smoke, with package tests on Windows Node 22 and 24. `contract` uses the real
packed artifact, TypeScript 5.9.3 full-library checks and TypeScript 7.0.2 consumer
surface checks. The latter keeps the documented upstream SDK `skipLibCheck` boundary;
it is not evidence of strict full-library TypeScript 7 compatibility.

No accepted local P2 implementation is replaced by a promise of future hosted CI.
Linux/macOS CI, Node 26 canary, remote issue/PR reconciliation and public publication
remain unverified and outside this no-push task. No new runner/workflow or remote
state is introduced by this audit. Runtime APIs/dependencies, DB and repository
hygiene policies are unchanged by the audit itself.

## Operational limits and deferred work

- The default audit policy stays best effort. Confirmation timeout does not cancel
  a sink write or enforce a business operation's audit obligation.
- Storage directories, publisher sequence allocation, origin promotion and pinned
  trust distribution belong to the caller. Restoring/deleting recovery history
  needs a separately trusted floor; local files alone cannot prove no rollback.
- Hash chains do not authenticate arbitrary full rewrites or tail removal without
  independently trusted checkpoints. The package exports/verifies checkpoints;
  operators own their external authentication/retention and consistent copies.
- Locks coordinate cooperating writers on trusted local storage. Partial writes
  fail closed; complete unacknowledged records can be accepted, so retries may
  duplicate events. Stale locks require confirming the old writer stopped.
- Windows ACLs and power-loss behavior depend on storage. Local injected failures
  and restart tests do not simulate every hardware failure or hosted OS.
- HMAC pseudonyms, S3/R2-specific clients, automatic schedules, additional runtimes
  and independent adoption are P3. No dashboard, database or management server is
  implied by completing P2. No push, tag, deployment or publication is authorized.
