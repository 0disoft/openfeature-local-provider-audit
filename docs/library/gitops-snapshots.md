# GitOps signed snapshot recipe

Status: executable SDK recipe; local validation only, no remote publication.

The publisher checks out a reviewed configuration Git revision, validates its
JSON/YAML file and signs a release. An existing HTTPS origin delivers the compact
JWS. Consumers verify it, persist acceptance and then activate locally. Evaluations
use memory, with no Git, HTTPS or filesystem work per request.

The executable composition is `examples/node-basic/src/gitops.ts`. Its helpers are
SDK example code, not new package-root exports. It uses the public file loader,
signer, verifier, HTTPS source, recovery store, provider and refresher APIs.

## Ownership and release inputs

| Owner | Responsibility |
| --- | --- |
| Configuration repository | Reviewed flag JSON/YAML and desired rollback contents |
| Publisher | Real Ed25519 private KeyObject, monotonic audience-specific sequence, current issuance/expiry |
| Existing HTTPS origin | Complete immutable artifact upload, atomic promotion of the current object, correct ETag |
| Application | Pinned public keys/audience, trusted recovery directory, safe bootstrap, refresh/shutdown scheduling |
| External recovery authority | Trusted minimum sequence/checkpoint after recovery-file loss or restoring backups |

The provider does not provision an origin, Git service, secret store, CI runner or
control plane. Origin upload/promotion commands are caller-owned and UNDECIDED by
this repository. The smoke run below exercises actual delivery on loopback HTTPS;
it does not establish production-origin credentials, caching or atomicity.

Use a durable increasing release sequence per audience. Git SHAs, branch names and
CI run numbers are not automatically a monotonic sequence. Serialize publisher
releases and retain the high-water mark through workflow resets and rollback.
Times are epoch milliseconds; select expiry/age/lifetime to match consumer policy.
Keep signing keys outside configuration/artifact repositories. Consumers get only
pinned public keys; distribute rotation trust before issuing a higher-sequence release.

## Validate and create an immutable artifact

Run the local validator against the reviewed configuration file. The recipe's
`createSignedRelease` also loads and validates the actual JSON/YAML before signing.
Existing project checks remain the review gate; no new automatic workflow is installed.

```ts
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSnapshotVerifier } from "@0disoft/openfeature-local-provider";
import { createSignedRelease } from "./gitops.js";

// privateKey is a real caller-supplied Ed25519 private KeyObject.
// configurationPath belongs to the checked-out reviewed configuration repository.
const gitRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: configurationRepository, encoding: "utf8"
}).trim();
const artifact = await createSignedRelease(configurationPath, {
  privateKey, keyId, audience, sequence,
  issuedAt: Date.now(), expiresAt: Date.now() + releaseLifetimeMs
});
const { provenance } = createSnapshotVerifier(verification).verify(Buffer.from(artifact));
const artifactName = `${gitRevision}.${sequence}.jws`;
await writeFile(join(outputDirectory, artifactName), artifact, { flag: "wx", mode: 0o600 });
await writeFile(join(outputDirectory, `${artifactName}.json`), JSON.stringify({
  gitRevision, ...provenance
}), { flag: "wx", mode: 0o600 });
```

The publisher manifest maps the real Git revision to the signed artifact and
semantic snapshot hashes. That manifest is caller-owned evidence; JWS authenticates
its documented claims/configuration, not a separate filename or unsigned manifest.
If Git revision must be signature-bound, the publisher can put the actual checked-out
revision in snapshot metadata before calling `signFlagSnapshot`. Retain full signed
artifacts and reviewed configuration; audit hashes alone cannot reconstruct them.

Upload the complete immutable artifact to the existing origin. Verify its bytes and
only then atomically promote the current URL/object using that origin's supported
operation. Give each changed artifact its correct validator, preferably its quoted
artifact SHA-256. A 304 must represent unchanged artifact bytes. Do not expose a
partially uploaded file or reuse a previous artifact's ETag for changed bytes.
No upload, Git push or deployment is performed by this recipe's local smoke command.

## Recover and refresh

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createGitOpsConsumer } from "./gitops.js";

const runtime = await createGitOpsConsumer({
  url: signedSnapshotUrl,
  recoveryPath: trustedRecoveryPath,
  verification, safeBootstrap,
  // Only true for an explicitly authorized first installation; omit on restarts.
  allowFirstStart: firstInstallation,
  auditSink
});
await OpenFeature.setProviderAndWait("checkout", runtime.provider);
const client = OpenFeature.getClient("checkout");

// Invoke from the application's existing refresh lifecycle; no automatic timer.
const inFlight = runtime.refresher.refresh();
await inFlight;
const enabled = await client.getBooleanValue("checkout.enabled", false, context);
```

The default first-start policy rejects a missing recovery journal. Do not silently
enable `allowFirstStart` when a disk is missing, corrupt or restored. Remove the
first-installation opt-in after a release has been accepted. Recovery failures are
startup errors; they never silently promote older history. An expired stored head
supplies the authenticated replay floor while `safeBootstrap` supplies active contents.
The example uses no ambient env overrides and omits all audit context key names.

Refresh coalesces overlapping calls. Validation/storage failures preserve active
state; successful durable acknowledgment precedes atomic activation and event
delivery. ETag caching still rechecks signatures/freshness and storage continuity.
Already active last-good values continue after fetch failure or expiry: applications
own stricter business policy. Feature flags do not replace authorization.

During shutdown, close the refresher, await any held in-flight promise and handle
its result, then close the provider or call the SDK's `clearProviders()`. Closing
cannot retract a disk commit that already started. Do not remove a recovery lock
until the writer is confirmed stopped. See `snapshot-recovery.md` for reservation,
ambiguous persistence, power-loss and trusted-storage boundaries.

## Roll back contents as a new release

```ts
import { createRollbackRelease } from "./gitops.js";
const rollback = await createRollbackRelease(runtime.store, desiredHistoricalSequence, {
  privateKey, keyId, audience,
  sequence: nextPublisherSequence,
  issuedAt: Date.now(), expiresAt: Date.now() + releaseLifetimeMs
});
// Retain/review the new artifact and promote it through the same origin procedure.
```

The helper selects authenticated retained contents and requires a higher sequence
and nondecreasing issuance in the same audience. The consumer independently checks
trust, sequence and freshness. Missing/pruned/untrusted historical entries fail
visibly. Older retained contents do not authorize replaying their old signed token.
For history outside the local retention window, restore the desired configuration
through a reviewed Git change and create a new higher-sequence signed release.
The publisher owns sequence allocation; the example does not allocate fleet-wide IDs.

## Reproduce the recipe locally

From the repository root, run `corepack pnpm run smoke:gitops`. OpenSSL must be
available (`req -addext`); Windows also checks the Git-for-Windows OpenSSL path.
The command generates real ephemeral signing/TLS keys, creates a loopback HTTPS
origin and temporary configuration/recovery/audit files, then removes them.

It checks JSON and YAML publication, explicit first-start policy, ETag 304, two
releases, higher-sequence rollback, fresh-consumer recovery, stale/corrupt signed
updates, zero network requests for repeated evaluations and redacted audit origins.
It uses the real OpenFeature SDK and workspace package. The separate recovery tests
cover an independent Node process; this example replaces SDK/provider instances.
The smoke is an opt-in existing-runner command, not another hosted CI workflow.
