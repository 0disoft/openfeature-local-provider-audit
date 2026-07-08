# @0disoft/openfeature-local-provider

Local OpenFeature provider for JSON/YAML flag snapshots, typed evaluation, explicit
CLI validation, environment overrides, deterministic rollout bucketing, replay fixtures,
and redacted audit logs.

## Install

```sh
npm install @0disoft/openfeature-local-provider @openfeature/server-sdk
```

## Quick Start

```ts
import { OpenFeature } from "@openfeature/server-sdk";
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

YAML input must parse into the same schema v1 snapshot contract used by JSON input.

## CLI Validation

```sh
npx -p @0disoft/openfeature-local-provider openfeature-local-provider validate ./flags.yaml
npx -p @0disoft/openfeature-local-provider openfeature-local-provider validate ./flags.json --json
```

The CLI is read-only. It validates local JSON/YAML snapshots, prints a small summary,
and exits with `0` for success, `1` for snapshot validation failure, or `2` for usage
errors.

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

const watcher = await watchFlagSnapshotFile({
  path,
  onSnapshot(snapshot) {
    provider.updateSnapshot(snapshot);
  },
  onError(error) {
    console.warn("Flag reload failed", error);
  }
});
```

`loadFlagSnapshotFile` supports `.json`, `.yaml`, and `.yml` files by extension.
Watcher reload failures are reported through `onError` and do not replace the last
valid snapshot. Evaluation never reads from disk on the flag resolution path.

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
keys.

## File Audit Sink

```ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileAuditSink,
  createLocalProvider,
  parseJsonFlagSnapshot
} from "@0disoft/openfeature-local-provider";

const snapshot = parseJsonFlagSnapshot(snapshotJson);
const auditSink = createFileAuditSink({
  path: join(tmpdir(), "openfeature-audit.jsonl"),
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  maxQueueSize: 1000,
  queueOverflowPolicy: "reject",
  lock: true
});
const provider = createLocalProvider({
  snapshot,
  auditSink
});

await auditSink.flush?.();
```

Audit events are redacted before they reach the sink. Provider audit writes are
non-blocking by default, and file write failures are reported through the OpenFeature
logger without changing the evaluated flag value.

Use `auditSink.flush?.()` before process exit when a short-lived script must wait for
pending non-blocking audit writes. Use `auditWriteMode: "blocking"` when each
evaluation promise must wait for its audit write.

Set `maxQueueSize` when local I/O pressure should not grow pending audit writes without
bound. The default is unbounded for compatibility. With a bounded queue, the default
overflow policy is `reject`; set `queueOverflowPolicy: "dropNewest"` to resolve the
overflowing write without appending that event. `auditSink.getStats?.()` returns pending
and dropped write counters when supported.

Set `maxBytes` to rotate the active audit file by size. `maxFiles` controls how many
rotated files are retained as `.1`, `.2`, and so on.

Treat the audit file path as trusted local configuration. Do not pass tenant, request, or
unvalidated user input directly into `path`.

Set `lock: true` when multiple local processes may write the same audit file. The lock is
advisory and uses a sibling `.lock` file. `lockTimeoutMs` controls acquisition timeout,
and `staleLockMs` can remove stale lock files left by crashed processes.

## Supported Runtime

- Node.js 22 LTS
- Node.js 24 LTS

Browser, Bun, Deno, hosted flag services, control-plane APIs, and remote streaming are
outside the current package boundary.
