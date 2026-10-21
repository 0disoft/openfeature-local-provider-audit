# Choose and try the provider

Status: local P3 adoption material; independent adoption remains unverified.

| Need | Entry / next step |
| --- | --- |
| OpenFeature registration, files/env, audit, signed refresh/recovery | Node 22/24 package root; start with node-basic and the GitOps recipe |
| In-process JSON flag evaluation with explicit context/time | `/core`; run the self-contained core-basic preview |
| Conditional object delivery | Caller-owned AWS SDK S3/R2 client and the bounded S3 source; no evaluation-time fetch |
| Current published stable behavior | npm v1; it does not include v2 targeting/schedule/core APIs |

The local v2 prerelease is 2.0.0-alpha.18. A read-only registry check on 2026-10-22
KST found latest=1.0.0 and next=1.0.0-rc.2. Installing @next does not install this
preview. No package, branch, tag or workflow was published for this work.

## Run a complete preview

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
preview wins before a scheduled stage, and emergency disable wins over targeting
and explicit overrides. It prints counts/reasons without subjects or contexts.
The contract command copies this unchanged source into a temporary consumer
installed from the actual tarball and executes it there, without a workspace link.

To try v2 in another application, build and pack the provider, install the exact
local .tgz path printed by pnpm plus the existing OpenFeature peer, and copy the
same index.mjs beside that application's package manifest. Run node index.mjs.
For example, after selecting the real path printed by your pack command:

```sh
pnpm run build
pnpm --filter @0disoft/openfeature-local-provider pack
# In your separate consumer, replace <actual-tarball-path> with the printed path:
npm install "<actual-tarball-path>" @openfeature/server-sdk@^1
node index.mjs
```

For current stable v1, use npm install @0disoft/openfeature-local-provider@^1
@openfeature/server-sdk@^1 and the [Node quick start](../../packages/local-provider/README.md).
The portable example requires v2. Runtime/TypeScript/peer declarations are in the
[compatibility matrix](../library/compatibility.md); whole-package Node engines
and the peer still exist even when a consumer imports only core. Browser/Workers
bundling can use the self-contained ESM core; do not import Node-root APIs there.

## Operational and privacy ownership

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

## Record a real independent use

Do not count this repository's examples, temporary smoke consumers, downloads,
stars or another same-maintainer repository as an independent adopter. Existing
stable v1 cross-repository evidence stays valid for its original release gate;
P3's independent-use requirement is a different, still-unmet condition.

A consenting external owner may provide this report through an authorized channel;
this work does not contact anyone or post an issue. Public links or a consented,
redacted private record can establish usage. Never include credentials or subjects.
A local preview tarball can establish preview use when its exact hash is recorded;
it does not establish a public npm release or satisfy v1's normal-registry gate.

```text
Consumer/project and immutable revision:
Owner relationship: independent / same-maintainer (state accurately)
Owner confirmation of actual use and permission to record this report:
Installed package version, install source and exact tarball SHA-256 if preview:
OS/architecture, runtime, SDK/compiler/build tool versions:
Actual integration path and user-facing behavior exercised:
Exact commands and observed results (including failures/workarounds):
Reproduction code or consented redacted artifact / CI-log links:
Production duration/load, if measured (otherwise leave unverified):
```

Acceptance needs both real usage evidence and accurate owner/consent disclosure.
An independently owned manifest alone is a candidate, not proof of exercised
behavior. The maintainer must review the real record; never synthesize a passing
report to close the requirement. See [current status](../testing/p3-adoption-status.md).
