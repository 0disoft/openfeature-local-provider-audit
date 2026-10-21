# P3 privacy, delivery and portability

Owner: 0disoft. Status: accepted for sequential local implementation.

Continue the completed P2 work on the existing main. Each finished slice gets its
own local verification and commit. No branches/worktrees, push, tag, deployment,
remote workflow or messages to external users are authorized. Preserve unrelated
changes. Per run: at most 20 minutes, start no new unit after 10 minutes; record
unfinished work and resume it first next time.

## Priority and acceptance

1. HMAC audit pseudonyms: opt-in bounded domain-separated HMAC-SHA-256 using a
   caller-owned secret, explicit nonpersonal key ID and deployment/tenant scope.
   Capture the secret, never serialize it or the subject. Derive only from an
   explicit targeting key. Default events stay uncorrelated. Preserve provenance,
   chain capture/verification, confirmed writes and replay/evaluation behavior.
   Rotation changes pseudonyms; document linkability and key compromise boundaries.
2. Scheduled rollout: explicit bounded time/percentage stages, deterministic
   buckets and offline simulation, without starting timers or workers. Preserve
   existing schema-v1/v2 behavior unless the caller opts into the new contract.
   Define time input, clock/rollback behavior, override/emergency priority and audit
   explanations before implementation.
3. S3/R2 snapshot retrieval: caller-owned credentials/client, bounded transport and
   cancellation, conditional object validation and existing signed durable refresh
   composition. Never add evaluation-time network I/O, secret logging or automatic
   infrastructure provisioning. Verify actual protocol behavior using local fixtures;
   production account access is a separate operational boundary.
4. Runtime portability: separate the pure evaluation boundary from Node transport,
   storage and SDK dependencies. Expose only a deliberate supported surface; verify
   actual browser/Bun/Deno/Workers execution before claiming support. Keep existing
   Node/OpenFeature API and ESM/CJS consumers compatible. Do not equate a successful
   bundle with runtime compatibility.
5. Independent adoption: prepare usable examples and reproducible performance/
   compatibility evidence. Actual external adoption requires a consenting external
   user and verifiable usage; same-maintainer smoke tests do not satisfy this item.
   Do not create adoption claims, contact others or publish without authorization.

## Progress and next action

P2 baseline: ebd6f18, unpublished 2.0.0-alpha.14. Initial worktree clean on main.
First implementation: HMAC helper and audit/provider/chain integration, migration,
privacy contract, focused failure/privacy tests and real packed ESM/CJS consumers.
All five priorities above remain tracked until their own acceptance is established.

### HMAC pseudonyms completed locally (2026-10-22 KST)

Planning/ADR commit: 323df30. Implementation commit: 008153c. Alpha.15 implements native domain-separated HMAC,
copied 32..128-byte secrets, isolated key IDs/scopes, bounded well-formed UTF-8
subjects and immutable metadata. Both providers/direct event creation opt in;
default or missing-subject records remain unchanged. Strict chain capture preserves
the four metadata fields without raw subjects/getters and authenticates them.
Snapshot/replay/metrics behavior and default audit policy remain unchanged.

Authoritative contract: `docs/library/audit-pseudonyms.md`, matching API/SDK,
migration, audit-chain, audit-event and threat-model docs. Tests prove native digest
bytes, copied key/config, scope/key rotation separation, input bounds/Unicode,
private output, unsafe custom metadata, old/default records, chain tampering and
real OpenFeature SDK + confirmed chain storage + existing failure policy.

`check`, `contract`, format, lint and diff whitespace checks passed. Windows Node
24.14.0 and 22.23.3 each passed 364 package tests with 6 existing platform skips.
Coverage: 93.95% statements / 92.02% branches / 99.44% functions / 95.55% lines.
The actual 222,089-byte alpha.15 tarball passed ESM/CJS HMAC/chain/runtime/CLI checks
and TypeScript 5.9.3 full-library / 7.0.2 consumer-surface checks; the latter retains
the documented upstream SDK skipLibCheck boundary. Reviewed API: 109 exports,
31 runtime values. No dependency, DB, runner/workflow or hygiene policy changed.
Hosted Linux/macOS remain unverified because no push is authorized.

Remaining P3, in order: scheduled rollout contract and implementation; bounded
S3/R2 delivery; runtime separation with actual runtime execution; independent
adoption material/evidence. Start the schedule contract next; define time input,
stable percentage stages, emergency/override precedence and replay semantics before
editing evaluation. External adoption itself remains unverified and cannot be
claimed by local smoke tests. No push, deployment or external messages performed.

### Scheduled rollout completed locally (2026-10-22 KST)

Contract commit 40157c7 defines the opt-in v2 stage/time/priority contract before
implementation. Alpha.16 adds bounded strictly ordered 1..100 time/percentage
stages, nondecreasing percentages, existing deterministic seeded buckets, explicit
pure evaluationTime and a caller-owned provider clock. Before-first/final stage,
stateless clock rollback and emergency/override/targeting precedence are explicit.
Unscheduled v1/v2 flags keep existing behavior and acquire no new clock reads.
No timer, watcher, delayed job or background worker is created.

Schedule decision time/stage/percentage reaches explanations, audit/strict chained
records and replay. Offline CLI evaluate/explain/simulate/compare accepts explicit
per-request times; comparison detects schedule decision changes even when values
agree. Authoritative contract: `docs/library/scheduled-rollout.md`, with schema,
scope, API/SDK, migration, replay, inspection, chain and threat-model updates.

Tests prove exact boundaries, backwards time, final stage, invalid time/key,
nonempty 200-subject expanding cohorts and equivalence to existing seeded buckets,
default seed, priority, immutable JSON/YAML validation and size/precision/order limits.
Real OpenFeature SDK/durable chain output proves a single trusted clock read and
rejects context time injection; direct/default/throwing clocks are covered. Fixed
offline requests prove explanation, aggregate on/off counts and schedule-only
comparison drift. Replay detects time/stage drift; chain capture rejects invalid
schedule metadata. Default audits and existing chain/replay fixtures stay compatible.

`check`, `contract`, format, lint and diff whitespace checks passed. Windows Node
24.14.0 and 22.23.3 each passed 370 package tests with 6 existing platform skips.
Coverage: 94.07% statements / 92.41% branches / 99.46% functions / 95.69% lines.
The actual 229,500-byte alpha.16 tarball passed ESM/CJS scheduled evaluation/replay,
HMAC + schedule chain storage/verification, actual packaged schedule explanation
and audit verification CLI, and existing
consumer contracts. TypeScript 5.9.3 full-library and 7.0.2 consumer-surface checks
passed (the latter retains the documented upstream SDK skipLibCheck boundary).
Reviewed API: 111 exports / 31 runtime values, with two new type exports. No
dependency, DB, runner/workflow, hygiene policy or remote state changed.

Remaining P3: bounded S3/R2 delivery contract and implementation next; runtime
separation with actual browser/Bun/Deno/Workers execution; independent adoption
material and verifiable external use. No claim of hosted Linux/macOS/current-source
CI or production origin/storage validation: no push or deployment is authorized.
The caller owns clock trust/monotonic floors, external checkpoints and rollout
business policy. No incomplete scheduled-rollout implementation is left in the
worktree; start the object-storage slice in the next run.
