# OpenFeature Local Provider

Feature flags inside your application, with no evaluation-time network requests.
Keep configuration under your control and record decisions without raw user identifiers
or evaluated values by default. One npm package; no flag server or sidecar to operate.

Built for Node.js/TypeScript teams that need local operation, reproducible rollouts,
and privacy-conscious audit trails. Use it in restricted-network services, internal
tools, or applications where configuration and audit storage stay in your environment.

| Your requirement | Included capability |
| --- | --- |
| Evaluate during a network outage | In-process JSON/YAML snapshots; retain last-good settings on invalid reload |
| Review a rollout before applying it | Conditional targeting, deterministic percentages, explicit schedules, offline simulation |
| Investigate a decision without logging the user's payload | Redacted explanations and audit events; opt-in HMAC correlation and chained storage |
| Control how configuration arrives | Local file watching or signed HTTPS/S3 delivery with durable recovery |

## Start With A Local File

```sh
npm install @0disoft/openfeature-local-provider @openfeature/server-sdk
```

Save this as `flags.json`:

```json
{
  "schemaVersion": 1,
  "flags": {
    "checkout.enabled": {
      "type": "boolean",
      "defaultVariant": "off",
      "variants": { "on": true, "off": false }
    }
  }
}
```

Register the provider in your Node.js application:

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createWatchedLocalProvider } from "@0disoft/openfeature-local-provider";

const runtime = await createWatchedLocalProvider({ path: "./flags.json" });
await OpenFeature.setProviderAndWait(runtime.provider);
const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout.enabled", false);

// After stopping application request intake, await shutdown:
await OpenFeature.close(); // stops the owned watcher and flushes provider audit writes
```

Change `defaultVariant` to `on` and replace the file to update subsequent evaluations
without redeploying application code. Invalid replacements keep the last-good snapshot.
This minimal example does not enable audit persistence; choose a sink below to record events.

## Choose Your Integration

- **A local configuration file:** [watched provider](docs/library/watched-provider.md),
  with reload diagnostics and optional consistency polling for projected volumes.
- **Signed configuration and restart recovery:** [managed provider](docs/library/managed-provider.md)
  and the [GitOps recipe](docs/library/gitops-snapshots.md), including explicit refresh,
  sequential polling and rollback.
- **Audit records:** [JSON Lines sinks and bounded queues](docs/library/audit-event-v1.md),
  [chained storage and verification](docs/library/audit-chain.md),
  [opt-in HMAC pseudonyms](docs/library/audit-pseudonyms.md), and
  [operational status](docs/library/operational-status.md).
- **Review configuration changes:** [inspection CLI](docs/library/local-inspection.md),
  [offline schemas and type generation](docs/library/authoring.md), and
  [reusable conditions](docs/library/reusable-conditions.md).
- **Evaluation without Node APIs:** the separate [`/core` entry](docs/library/compatibility.md)
  and [complete runnable example](docs/sdk/adoption-guide.md).

## Operational Fit

The package root supports Node.js 22 and 24. OpenFeature is a peer dependency;
the package is Apache-2.0 licensed. The optional `/core` entry has separately scoped
Chromium, Bun, Deno and workerd runtime evidence.

Your application owns configuration authorization, storage permissions, retention
and process shutdown. Managed provider close operations already stop owned resources
and perform bounded audit flush; timeouts do not guarantee outstanding I/O has stopped.
See [runtime recipes](docs/ops/runtime-recipes.md) and the
[privacy and redaction contract](docs/security/privacy-and-redaction.md) for deployment choices.

Choose a managed platform when you need a hosted dashboard, approvals, user database
or experiment analytics. This package supplies local evaluation and operational tools.
Audit integrity is checked against trusted checkpoints; it is not a compliance certification
or a guarantee that application-defined identifiers contain no sensitive information.
See the [threat model](docs/security/threat-model.md).

## Compatibility And Evidence

Installations use npm `latest`. Read the exact checkout version from the
[package metadata](packages/local-provider/package.json). Existing schema v1 snapshots
remain supported; review exhaustive reason/schema switches when upgrading from v1.
See the [2.0 migration guide](docs/library/migration-to-2.0.md); use `@^1` to retain
the previous major's API contract.

- [Published package and multi-platform consumer checks](docs/testing/registry-consumer-evidence.md)
- [Repeatable evaluation and audit benchmarks](docs/testing/evaluation-performance.md)
- [Runtime compatibility matrix](docs/library/compatibility.md)
- [Maintenance scope and delivery record](docs/product/06-maintenance-and-targeting.md)

Benchmark reports state their workload, runtime and hardware boundary. They are measurements,
not production latency guarantees. Adoption provenance is recorded with the evidence.

## Repository Map

- [Package source and API examples](packages/local-provider)
- [Runnable Node/OpenFeature example](examples/node-basic)
- [Public API contract](docs/library/public-api.md) and [library documentation](docs/library)
- [Security](docs/security), [operations and release](docs/ops), [validation commands](VALIDATION.md)
