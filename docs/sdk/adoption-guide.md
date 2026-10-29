# Choose and try the provider

Status: local P3 usage material complete; independent adoption evidence/recording
excluded from P3 acceptance by owner decision on 2026-10-22 KST. Actual external
adoption remains unverified.

| Need | Entry / next step |
| --- | --- |
| OpenFeature registration, files/env, audit, signed refresh/recovery | Node 22/24 package root; start with node-basic and the GitOps recipe |
| In-process JSON flag evaluation with explicit context/time | `/core`; run the self-contained core-basic example |
| Conditional object delivery | Caller-owned AWS SDK S3/R2 client and the bounded S3 source; no evaluation-time fetch |
| Targeting, schedules, managed delivery and core evaluation | npm `@^2`; retain `@^1` for the previous API contract |

The exact repository version is declared in the
[package metadata](../../packages/local-provider/package.json). From the repository
root, print it with `node -p "require('./packages/local-provider/package.json').version"`.
The build/pack commands below operate on that version; no registry tag is needed.

Historical registry evidence: a read-only check on 2026-10-22 KST found
latest=1.0.0 and next=1.0.0-rc.2. These are dated observations, not a current registry
query. Version 2.0 is installed through npm `latest`; the older channels do not
describe the current release. Older runtime evidence keeps its
original tested version; it does not establish current-checkout runtime coverage.

## Run a complete example

From this checkout after installing the declared pnpm/Node toolchain:

```sh
pnpm install --frozen-lockfile
pnpm run smoke:core-example
pnpm run contract
```

[core-basic/index.mjs](../../examples/core-basic/index.mjs) is the complete public
consumer source, with no placeholder credentials, undefined variables, timers or
network calls. It uses explicit fixed times and 200 stable non-personal example
keys. The observed aggregate stages are 0, 51 and 200 enabled subjects. A percentage
is cohort eligibility, not an exact small-population count. It also proves internal
tenant targeting wins before a scheduled stage, and emergency disable wins over targeting
and explicit overrides. It prints counts/reasons without subjects or contexts.
The contract command copies this unchanged source into a temporary consumer
installed from the actual tarball and executes it there, without a workspace link.

To use 2.0 in another application, install the package and its OpenFeature peer:

```sh
npm install @0disoft/openfeature-local-provider@^2 @openfeature/server-sdk@^1
```

To test unpublished checkout changes instead, build and pack the provider, install
the exact local .tgz path printed by pnpm, and copy the same index.mjs beside that
application's package manifest. Run node index.mjs. For example:

```sh
pnpm run build
pnpm --filter @0disoft/openfeature-local-provider pack
# In your separate consumer, replace <actual-tarball-path> with the printed path:
npm install "<actual-tarball-path>" @openfeature/server-sdk@^1
node index.mjs
```

To retain v1, use npm install @0disoft/openfeature-local-provider@^1
@openfeature/server-sdk@^1 and the [Node quick start](../../packages/local-provider/README.md).
The portable example requires v2. Runtime/TypeScript/peer declarations are in the
[compatibility matrix](../library/compatibility.md); whole-package Node engines
and the peer still exist even when a consumer imports only core. Browser/Workers
bundling can use the self-contained ESM core; do not import Node-root APIs there.

## Operational and privacy ownership

Start signed Node integrations with the [managed provider](../library/managed-provider.md):
create an HTTPS or S3 source, then one helper for authenticated recovery, provider,
refresh, explicit polling and shared SDK shutdown. The GitOps example uses this
same public helper rather than copying its low-level composition into each app.

- Use the [signed GitOps recipe](../library/gitops-snapshots.md) and existing
  executable node-basic GitOps smoke for pinned verification, restart recovery,
  last-good behavior and caller-owned refresh/shutdown scheduling.
- For object delivery follow [S3/R2](../library/s3-snapshots.md): real client,
  credentials/TLS, maxAttempts: 1 underneath bounded source retries. ETags are not
  integrity proofs; signature and durable sequence policy are separate.
- For audit correlation read [HMAC pseudonyms](../library/audit-pseudonyms.md): a
  caller-owned real secret, nonpersonal key ID and tenant/deployment scope. Default
  audit events stay uncorrelated. Pseudonyms are linkable, not anonymized identities.
- Use [chained audit contracts](../library/audit-chain.md) with caller-owned external
  checkpoints. Audit success is not application authorization or an fsync guarantee.
- Own the trusted time, stable targeting key, refresh cadence, shutdown and data
  retention. Backwards time selects the corresponding stage; there is no hidden
  scheduler. Never ship private rules/secrets to public clients. Flags are not
  access control. Keep logs free of raw subjects, context and evaluated object data.

## Reproduce compatibility and performance

```sh
pnpm run check
pnpm run smoke:core-runtimes
pnpm run benchmark:evaluation --iterations 2000 --output .git/local-evaluation.json
```

The runtime smoke requires installed Bun, Deno and Chromium; optional
CORE_BUN_BINARY, CORE_DENO_BINARY and CORE_BROWSER_BINARY select real executables.
The committed [runtime acceptance](../testing/core-runtime-acceptance.md) records
1,449 evaluations plus three parser failures per runtime, exact versions, hashes
and Windows x64 scope. Workerd disables both Node compatibility modes explicitly;
no hosted deployment or recurring workflow is part of these commands.
[Performance evidence](../testing/p3-adoption-status.md) contains the actual local
Node run and limitations. Repeat on the consuming app's host, workload and storage;
these are not production SLOs, competitor comparisons or cross-runtime speed claims.

## Evidence boundaries

Do not count this repository's examples, temporary smoke consumers, downloads,
stars or another same-maintainer repository as an independent adopter. Existing
stable v1 cross-repository evidence stays valid for its original release gate.
The owner excluded P3 independent-use evidence and recording on 2026-10-22; no
external report or consent collection is required to finish P3. This change does
not establish real adoption, authorize outreach/publication, or change the v1
normal-registry release gate. Local checkout results do not establish published artifact identity.
See [current status](../testing/p3-adoption-status.md).


Local unsigned file integrations can use `createWatchedLocalProvider` instead of
manually loading a file, constructing a provider and forwarding watcher callbacks.
The factory starts monitoring explicitly, provides reload/status and shares SDK
shutdown with its watcher cleanup. Existing low-level APIs keep their behavior.
See `docs/library/watched-provider.md` and the executable node-basic example.
