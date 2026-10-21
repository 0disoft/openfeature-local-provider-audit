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
