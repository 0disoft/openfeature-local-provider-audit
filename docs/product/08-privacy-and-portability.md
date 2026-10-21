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

### S3/R2 snapshot delivery completed locally (2026-10-22 KST)

Contract commit c8c7a93 precedes the alpha.17 implementation. New opt-in
createS3SnapshotSource captures the caller-owned SDK getObject method and trusted
bucket/key. It shares ETag syntax and source bounds with HTTPS; actual SDK 304
exceptions map to notModified, while partial/error statuses, compressed/unsupported
bodies, invalid lengths and overruns fail without exposing SDK causes or paths.
Total per-attempt deadlines and abort races also bound clients/iterators that
ignore cancellation. Late bodies close, backoff cancels, and retries are finite.
Byte copies coalesce into bounded blocks, preventing tiny chunks from growing
unbounded bookkeeping and protecting against caller buffer reuse. The source
starts no workers or evaluation-time requests and never destroys the shared client.

Seven focused tests use the actual AWS SDK v3 anonymous loopback HTTP protocol
(no fabricated credentials) for addressing, ETag/304 and access-denied parsing.
They cover Node/Web/Blob byte streaming, length/size/encoding/status failures,
transport/body stalls, late cleanup, cancellation, transient retries and privacy.
Signed SDK bytes commit through the existing verifier/store; corrupted responses
preserve the last accepted ETag, provenance and snapshot, and a reopened file store
recovers the exact signed artifact. Repeated provider evaluation performs no I/O.

check and contract passed. Windows Node 24.14.0 and 22.23.3 each passed 377 package
tests, with 6 existing platform skips. Coverage: 94.00% statements / 92.31% branches /
98.70% functions / 95.61% lines. The actual 237,561-byte tarball passed ESM/CJS object
source consumers and existing CLI/signed/schedule/audit contracts, TypeScript 5.9.3
full-library and 7.0.2 consumer-surface checks (documented upstream skipLibCheck
boundary retained). API baseline: 114 exports / 32 runtime values, adding one
factory and two structural types. AWS SDK client-s3 ^3.1153.0 (Apache-2.0) is dev-only
for real compatibility tests; declaration and lockfile agree, supply-chain policies
passed, and no SDK dependency is imported into library code/public declarations.
No DB, runner/workflow or hygiene policy changes.

Remaining P3, in order: runtime separation and actual browser/Bun/Deno/Workers
execution, then adoption material and independently verifiable external use.
Begin with an explicit minimal portable evaluator/parser contract; inspect current
Node crypto/Buffer/SDK dependencies before choosing a portable implementation.
Preserve Node behavior and reviewed root API. No incomplete S3 unit remains.
Production AWS/R2 credentials, IAM, TLS/account endpoints and hosted cross-platform
CI remain unverified because no cloud access, push or deployment is authorized.
A custom SDK client may continue internal work after ignoring abort; callers own
its lifecycle and must set SDK maxAttempts: 1 to preserve actual attempt bounds.
No external adoption claim or external message is authorized.

### Portable evaluation boundary completed locally (2026-10-22 KST)

Contract commit b6fbf6f precedes alpha.18. The additive /core subpath provides
synchronous evaluateFlag, JSON snapshot parsing, errors/reasons and their deliberate
platform-neutral types. Shared evaluation, rollout rules and core types now have
no Node/SDK imports. The Node wrapper retains native SHA-256; the portable wrapper
injects maintained noble SHA-256 with the exact UTF-8 / first-eight-byte / modulo
contract. Nothing about the hash is configurable by evaluation inputs. Root
provider/inspection/audit/file APIs and compatibility remain Node-only.

Two focused tests compare 4,096 native/portable requests plus 128 override cases
across seeds, Unicode (including malformed UTF-16), v1/v2 rules, semver, rollout,
schedule/time, missing flags, errors and immutability. Existing behavior tests also
cover the shared engine. A separate neutral build follows the existing Node build
serially, avoiding shared Node declaration chunks and leaving native dependency
resolution intact. Core ESM is 99,318 bytes (about 23 KiB gzip); bundled noble/semver
MIT/ISC notices are shipped in THIRD_PARTY_NOTICES. Noble hashes ^2.4.0 is dev-only;
the declaration and lockfile agree and install supply-chain checks passed. Runtime
package dependencies remain unchanged. typesVersions preserves legacy TypeScript
subpath resolution instead of disabling the existing package compatibility gate.

check, contract, format, lint and whitespace checks passed. Windows Node 24.14.0 and
22.23.3 each passed 379 package tests with 6 existing platform skips. Coverage:
93.97% statements / 92.27% branches / 98.71% functions / 95.58% lines. The actual
398,708-byte alpha.18 tarball passed existing root/CLI consumers and core ESM/CJS
schedule/bucket parity. Core strict consumer compilation uses only ES2022 and no
Node ambient types, with skipLibCheck false under both TypeScript 5.9.3 and 7.0.2.
The existing root's documented latest-compiler SDK skipLibCheck boundary remains.
Reviewed root API stays 114 exports / 32 values; core has its own 26-export / 7-value
declaration baseline, runtime parity and version-aware rebaseline gate.

The configured Node evaluation benchmark ran 2,000 iterations per case on Windows
Node 24.14.0, with all correctness/refresh checks passing. First two informational
samples: pure-static-1-flags p95 1.50 us; pure-rollout-1-flags p95 16.90 us. These samples do not establish a baseline comparison or
cross-runtime performance guarantee. No DB, CI workflow or hygiene policy changed;
the existing build/API/packed-consumer runners now include core validation.

The documentation append helper briefly truncated existing document bodies. The
release-readiness check caught the missing queue contract; originals were restored
from the current commit, additions reapplied and full checks passed. No original
tracked document content was intentionally removed.

Remaining P3, in order: execute the actual packaged core in browser, Bun, Deno and
local workerd with a shared deterministic corpus and no Node polyfills, then update
ADR 0004/compatibility matrix only to match real evidence. Build success and Node
checks do not prove those runtimes. Bun is installed on this host; Deno/workerd
availability and a real browser still need inspection. Keep verification local,
one process at a time, clean up fixtures and do not deploy Cloudflare resources.
After runtime acceptance, prepare reproducible adoption material; actual independent
adoption still needs a consenting external user and verifiable usage. Do not message
or publish to obtain it. No incomplete core code is left; runtime evidence remains
explicitly unfinished. No push, tag, deployment or hosted CI run was performed.
