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

Alpha.4 adds the observable provider interfaces and `operational-status.md` contract.
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

Remaining: audit failure policy and OpenTelemetry adapter, HTTPS delivery,
signatures/persistent recovery, GitOps recipe, audit chain/checkpoint verification.
