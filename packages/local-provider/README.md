# @0disoft/openfeature-local-provider

Local OpenFeature provider for JSON/YAML flag snapshots, typed evaluation, explicit
CLI validation, environment overrides, deterministic rollout bucketing, replay fixtures,
and redacted audit logs.

## Review a configuration change

With version 2.1 or a built checkout, compare the same synthetic requests against
two snapshots and emit a human-readable report:

```sh
openfeature-local-provider compare before.json after.json --requests synthetic-requests.json --output markdown
```

The report shows aggregate changes, selected rules and evaluation errors without
raw values or user context. It checks the supplied corpus, not production traffic.
Default output stays JSON; Markdown output retains the existing exit codes and
change limits. Names may still be sensitive. See the repository's
`docs/library/local-inspection.md` for report limits and deployment availability.

Version 2.2 or a built checkout also accepts `--output html > review.html` for a
standalone static view with summary cards, per-flag change meters, expandable tables
and print styles. Open the file locally; it contains no scripts, external assets
or live connection. It preserves the same redaction, sample limits and exit codes.

## Managed local file monitoring

`createWatchedLocalProvider({ path })` starts the existing JSON/YAML watcher and
creates a provider from its single initial load. Register runtime.provider through
OpenFeature; use runtime.reload() for explicit revalidation and runtime.close() for
owned watcher/provider shutdown. SDK shutdown shares that same cleanup. Failures
retain last-good contents and are available through optional onFailure diagnostics.
Ambient env overrides and context key names default off. See the repository's
`docs/library/watched-provider.md` and executable node-basic example. This API is
included in 2.0. Install through npm `latest`; installations pinned to `@^1`
retain the previous API surface.

## Managed signed delivery

The Node package root exports `createManagedLocalProvider`. Pass an HTTPS or S3
source, pinned verification policy, recovery path and safe bootstrap to connect
signature verification, restart recovery and the provider. `refresh()` is explicit;
`start()` opts into sequential polling. `close()` and SDK shutdown stop refreshes
and share bounded audit cleanup. No network request or poll timer starts during
construction. First startup needs explicit authorization; ambient env overrides
and context-key logging are off by default. Existing low-level APIs remain.

See the repository's `docs/library/managed-provider.md` and executable GitOps
example for inputs, authenticated recovery and ownership. This feature is included
in 2.0 and installed through npm `latest`.

## Install

```sh
npm install @0disoft/openfeature-local-provider @openfeature/server-sdk
```

## Quick Start

```ts
import { OpenFeature, ProviderEvents } from "@openfeature/server-sdk";
import { createLocalProvider, parseJsonFlagSnapshot } from "@0disoft/openfeature-local-provider";

const snapshot = parseJsonFlagSnapshot(
  JSON.stringify({
    schemaVersion: 1,
    flags: {
      "checkout.enabled": {
        type: "boolean",
        defaultVariant: "on",
        variants: {
          on: true,
          off: false
        }
      }
    }
  })
);

await OpenFeature.setProviderAndWait(createLocalProvider({ snapshot }));

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout.enabled", false);
```

## Percentage Rollout

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createLocalProvider, parseJsonFlagSnapshot } from "@0disoft/openfeature-local-provider";

const snapshot = parseJsonFlagSnapshot(
  JSON.stringify({
    schemaVersion: 1,
    flags: {
      "checkout.rollout": {
        type: "boolean",
        defaultVariant: "off",
        variants: {
          on: true,
          off: false
        },
        rollout: [
          {
            variant: "on",
            percentage: 25,
            seed: "checkout-rollout-v1"
          }
        ]
      }
    }
  })
);

await OpenFeature.setProviderAndWait(createLocalProvider({ snapshot }));

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout.rollout", false, {
  targetingKey: "account-123"
});
```

Rollout selection is deterministic for the same flag key, targeting key, and seed.

## YAML Snapshots

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createLocalProvider, parseYamlFlagSnapshot } from "@0disoft/openfeature-local-provider";

const snapshot = parseYamlFlagSnapshot(`
schemaVersion: 1
flags:
  checkout.enabled:
    type: boolean
    defaultVariant: "on"
    variants:
      "on": true
      "off": false
`);

await OpenFeature.setProviderAndWait(createLocalProvider({ snapshot }));
```

YAML input must parse into the same snapshot contract used by JSON input.
Snapshot objects, flag definitions, and rollout rules reject unknown fields; flag names,
variant names, and metadata keys remain caller-defined.

## Editor Schemas

Offline JSON Schemas are exported as `@0disoft/openfeature-local-provider/schemas/v1.json`
and `@0disoft/openfeature-local-provider/schemas/v2.json`. Associate them with files in
your editor; do not insert `$schema` into snapshots. Runtime validation still checks
references, rollout totals and other semantic constraints. See the
[authoring contract](https://github.com/0disoft/openfeature-local-provider-audit/blob/main/docs/library/authoring.md).

## Flag Type Generation

```sh
openfeature-local-provider generate-types ./flags.yaml > flags.d.ts.tmp
```

After exit 0, replace your declarations with the temporary output. The CLI emits
standalone `FlagValues`, `FlagKey` and `FlagValue<K>` declarations, sorted and escaped,
without variant values. Primitive types remain broad and objects remain JSON
objects/arrays because environment overrides may differ from configured variants.
Regenerate when keys or types change; see the authoring contract above for details.

## CLI Validation

```sh
npx -p @0disoft/openfeature-local-provider openfeature-local-provider validate ./flags.yaml
npx -p @0disoft/openfeature-local-provider openfeature-local-provider validate ./flags.json --json
```

The CLI is read-only. It validates local JSON/YAML snapshots, prints a small summary,
and exits with `0` for success, `1` for snapshot validation failure, or `2` for usage
errors.

## Conditional Targeting (Schema V2)

Version 2.0 also accepts the following JSON/YAML shape.
Stable 1.0 readers reject v2. Existing v1 snapshots retain their old behavior.

```json
{
  "schemaVersion": 2,
  "flags": {
    "checkout.enabled": {
      "type": "boolean",
      "defaultVariant": "off",
      "variants": { "on": true, "off": false },
      "rules": [{
        "id": "pilot-tenants",
        "when": { "all": [
          { "attribute": ["tenant"], "op": "in", "value": ["pilot", "beta"] },
          { "attribute": ["appVersion"], "op": "semverGte", "value": "2.0.0" }
        ] },
        "rollout": [{ "variant": "on", "percentage": 25, "seed": "checkout-v1" }]
      }]
    }
  }
}
```

Pass `tenant`, `appVersion`, and `targetingKey` through the OpenFeature evaluation
context. The first matching rule wins. Missing/wrong-type attributes do not match;
matched rollout without a non-empty targeting key returns caller default with
`INVALID_CONTEXT`. Unallocated buckets use the flag default instead of another rule.
Keep flag key, seed, and interval start stable when expanding a percentage.

Set `disabledVariant: "off"` on a v2 flag to force that variant ahead of environment
overrides and targeting, including malformed overrides. Removing it restores normal
priority. Updates become effective after successful snapshot application; watcher and
delivery delays still apply. Feature flags do not replace authorization checks.

`explainEvaluation(snapshot, request)` returns visited rule IDs/match outcomes and
selection metadata without values or raw context. Rule IDs, flag and variant names
must themselves be non-sensitive. Snapshot hashes identify content, not authorship.

```sh
openfeature-local-provider evaluate flags.json --request request.json
openfeature-local-provider simulate flags.json --requests requests.json
openfeature-local-provider compare before.json after.json --requests requests.json
```

A request file contains `{ "flagKey": "checkout.enabled", "expectedType": "boolean",
"defaultValue": false, "targetingKey": "synthetic", "context": { "tenant": "pilot",
"appVersion": "2.1.0" } }`. Simulation/comparison uses an array of such requests.
Commands are local and read-only, use only explicit overrides, and never read process
environment implicitly. Evaluation emits a redacted explanation; simulation/comparison
emits aggregate counts and changed-value/decision counts without individual values.
Inputs are bounded to 10 MiB per file, 10,000 requests, 32 levels and 100,000 JSON nodes.
Exit codes are 0 for success, 1 for input/evaluation errors, and 2 for usage errors.
Differences alone do not fail comparison. Detailed schema, migration and inspection
contracts are in the repository's `docs/library/` directory.

## File Loading And Reload

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createReloadableLocalProvider,
  loadFlagSnapshotFile,
  watchFlagSnapshotFile
} from "@0disoft/openfeature-local-provider";

const path = new URL("./flags.yaml", import.meta.url);
const provider = createReloadableLocalProvider({
  snapshot: await loadFlagSnapshotFile(path)
});

await OpenFeature.setProviderAndWait(provider);
OpenFeature.getClient().addHandler(ProviderEvents.ConfigurationChanged, (details) => {
  console.log("Changed flags", details?.flagsChanged ?? []);
});

const watcher = await watchFlagSnapshotFile({
  path,
  consistencyPollIntervalMs: 1000,
  onSnapshot(snapshot) {
    provider.updateSnapshot(snapshot);
  },
  onError(error) {
    console.warn("Flag reload failed", error);
  }
});
```

`loadFlagSnapshotFile` supports `.json`, `.yaml`, and `.yml` files by extension.
Snapshot files are limited to 10 MiB by default; pass `maxBytes` when a local process
needs a different limit. The loader uses a bounded read from one open file handle, so a
replacement or file growth cannot bypass that limit. Watcher reload failures are reported through `onError` and do
not replace the last valid snapshot. Evaluation never reads from disk on the flag
resolution path. macOS combines native file and directory watchers so direct writes and
atomic replacements use their strongest event source, and rearms direct file watching after
replacement. Windows file watching uses path polling internally to avoid unstable native
file-event behavior on Node.js 24. Native watcher and reload errors are reported through
`onError`. Event-driven reloads suppress callbacks for an unchanged parsed snapshot; explicit
`reload()` calls still invoke `onSnapshot` after successful validation.

`consistencyPollIntervalMs` is opt-in and must be an integer of at least 50 ms. It adds
metadata polling for visible paths backed by projected-volume symlink swaps while retaining
native events as the primary signal. Unchanged metadata does not read or parse the snapshot.
Successful semantic provider updates emit OpenFeature `PROVIDER_CONFIGURATION_CHANGED` with
code-unit-sorted added, removed, and changed flag keys.

Call `watcher.close()` during process shutdown when the file watcher is no longer
needed.

## Environment Overrides

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createLocalProvider, parseJsonFlagSnapshot } from "@0disoft/openfeature-local-provider";

const snapshot = parseJsonFlagSnapshot(
  JSON.stringify({
    schemaVersion: 1,
    flags: {
      "checkout.enabled": {
        type: "boolean",
        envVar: "CHECKOUT_ENABLED",
        defaultVariant: "on",
        variants: {
          on: true,
          off: false
        }
      }
    }
  })
);

await OpenFeature.setProviderAndWait(
  createLocalProvider({
    snapshot,
    env: {
      CHECKOUT_ENABLED: "false"
    }
  })
);
```

Environment variables are explicit. The provider does not invent variable names from flag
keys. Explicit JSON overrides are limited to 10 MiB by default; pass
`maxOverridesJsonBytes` when creating overrides or providers that need a different local
limit.

## File Audit Sink

```ts
import { join } from "node:path";
import {
  createFileAuditSink,
  createLocalProvider,
  parseJsonFlagSnapshot
} from "@0disoft/openfeature-local-provider";

const snapshot = parseJsonFlagSnapshot(snapshotJson);
const auditSink = createFileAuditSink({
  path: join(process.cwd(), "var", "audit", "openfeature.jsonl"),
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  maxQueueSize: 1000,
  queueOverflowPolicy: "reject",
  lock: true
});
const provider = createLocalProvider({
  snapshot,
  auditSink,
  auditRedaction: {
    contextKeys: "none"
  }
});

await auditSink.flush?.();
```

Audit events are redacted before they reach the sink. Provider audit writes are
non-blocking by default, and file write failures are reported through the OpenFeature
logger without changing the evaluated flag value.

New audit directories and files use private `0700` and `0600` modes on POSIX systems.
The final audit path must be a regular, current-user-owned file with one hard link and
must not be a symbolic link. Keep the whole path inside an application-owned directory;
on Windows, enforce this with directory ACLs because no-follow open is not available.

Context keys are counted by default without including their names. Set
`auditRedaction.contextKeys` to `"names"` only for fixed schema-like keys when names are
required, or to `"none"` to omit both names and count. These modes never enable raw
context values; `targetingKeyPresent` remains a boolean presence signal.

Use `auditSink.flush?.()` before process exit when a short-lived script must wait for
pending non-blocking audit writes. Use `auditWriteMode: "blocking"` when each
evaluation promise must wait for its audit write. `OpenFeature.close()` invokes the
provider close hook, which flushes the configured sink without taking ownership of or
closing a sink that another provider may share.

The queue is bounded to 5,000 pending writes by default. Set a positive `maxQueueSize` to
choose another count limit. Pending event payload is also limited to 64 MiB by default;
`maxQueueBytes` accepts a positive safe integer or null. Each null disables only its
own bound; both must be null for fully unbounded behavior. Pending bytes include
UTF-8 event JSON and newline, not JS heap overhead or chain-envelope bytes. The default overflow policy is
`reject`; set `queueOverflowPolicy: "dropNewest"` to resolve the overflowing write without
appending that event. `auditSink.getStats?.()` returns pending, dropped, and rejected
write counters, `pendingBytes`, and effective count/byte limits. Counters are cumulative for the sink
lifetime.

Set `maxBytes` to rotate the active audit file by size. `maxFiles` controls how many
rotated files are retained as `.1`, `.2`, and so on.

Treat the audit file path as trusted local configuration. Do not pass tenant, request, or
unvalidated user input directly into `path`.

Set `lock: true` when multiple local processes may write the same audit file. The lock is
advisory and uses a sibling `.lock` file. `lockTimeoutMs` controls acquisition timeout.
`staleLockMs` is deprecated and rejected because time-based takeover can delete a
live writer's lock. Stop all writers before manually recovering an abandoned marker.
This is local-filesystem coordination, not a distributed lock or fencing mechanism.
Provider `onClose` detaches events/metrics immediately and waits at most 5,000 ms for
flush by default; `auditShutdownTimeoutMs` sets another limit. Timeout rejects without
cancelling pending I/O or closing a caller-owned shared sink.

Multiple sinks loaded from the same package instance are serialized by audit path within
one process. Separate processes or duplicate installed package instances still require
`lock: true` when they share a rotating audit path.

## Supported Runtime

- Node.js 22 LTS
- Node.js 24 LTS

Browser, Bun, Deno, hosted flag services, control-plane APIs, and remote streaming are
outside the current package boundary.

Caller-triggered S3/R2 delivery uses `createS3SnapshotSource` with a caller-owned
AWS SDK v3 client; credentials and transport remain application concerns. Compose
with the existing signed refresher and recovery store. See
[bounded object snapshots](https://github.com/0disoft/openfeature-local-provider-audit/blob/main/docs/library/s3-snapshots.md).

The opt-in `/core` subpath provides synchronous `evaluateFlag` and
`parseJsonFlagSnapshot` without Node/SDK imports. Its packed ESM was verified on Chromium 149, Bun 1.4.3, Deno 2.9.6 and local
workerd 2026-10-19 on Windows x64; root provider/audit APIs remain Node-only. See
[portable core contract](https://github.com/0disoft/openfeature-local-provider-audit/blob/main/docs/library/portable-core.md).
Bundled MIT/ISC dependency notices are in THIRD_PARTY_NOTICES.
