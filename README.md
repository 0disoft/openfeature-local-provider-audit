# OpenFeature Local Provider

Local OpenFeature provider for JSON/YAML flag snapshots, explicit environment overrides,
deterministic percentage rollout, replay fixtures, and redacted audit logs.

```sh
npm install @0disoft/openfeature-local-provider @openfeature/server-sdk
```

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

## What It Owns

- JSON and YAML flag snapshot parsing with schema v1 validation.
- Opt-in schema v2 conditional targeting, conditional percentage rollout and emergency
  variant selection (unpublished 2.0 development version).
- Redacted evaluation explanations and local simulation/comparison CLI commands.
- Local CLI validation for JSON/YAML flag snapshots.
- Typed OpenFeature evaluation for boolean, string, number, and object values.
- Explicit per-flag environment overrides.
- Deterministic percentage rollout with replayable bucketing.
- Redacted audit event generation and optional JSON Lines file sinks.
- Replay fixtures for compatibility-sensitive evaluation behavior.
- Opt-in projected-volume consistency polling for local snapshot watchers.
- OpenFeature configuration-change events with deterministic changed-flag keys.

## What It Does Not Own

- Hosted flag management.
- Remote control planes, streaming updates, dashboards, or approval workflows.
- User segment databases or experiment analytics.
- Browser, Bun, Deno, HTTP API, database, Kubernetes, or Terraform runtime support.

## Choosing This Provider

Use it for Node.js applications that want caller-owned configuration, deterministic
local evaluation, and audit records that omit raw user identifiers and values by
default. Evaluation performs no network requests. The caller still owns access
control, secure configuration delivery, audit retention, and shutdown/flush handling.
Snapshot hashes identify content; they do not authenticate its author or encrypt
low-entropy configuration. File locks are advisory, and audit failures do not reject
feature evaluation by default.

Local evaluation also exists in other providers, including flagd. See the
[maintenance and targeting delivery plan](docs/product/06-maintenance-and-targeting.md)
for current gaps and local issue/PR disposition. Independent external adoption has
not yet been established; published consumer evidence identifies same-maintainer use.

The working tree stages `2.0.0-alpha.3`; npm `latest` is still `1.0.0`. New v2
features require building this checkout and are not available from the stable install
command above. See [v2 targeting](docs/library/flag-file-schema-v2.md),
[inspection CLI](docs/library/local-inspection.md), and
[migration](docs/library/migration-to-2.0.md).

## Runtime And Package Policy

- Package: `@0disoft/openfeature-local-provider`.
- License: Apache-2.0.
- Runtime: server-side Node.js 22 LTS and Node.js 24 LTS.
- OpenFeature SDK: `@openfeature/server-sdk` is a peer dependency.
- Package manager: pnpm workspace.
- Public releases: tag-triggered GitHub Actions workflow with npm trusted publishing
  and provenance.

## Repository Map

- [packages/local-provider](packages/local-provider): published package source.
- [examples/node-basic](examples/node-basic): runnable Node/OpenFeature example.
- [docs/library/public-api.md](docs/library/public-api.md): public API contract.
- [docs/library](docs/library): flag schema, env override, bucketing, audit, replay,
  semver, and compatibility contracts.
- [docs/security](docs/security): privacy, redaction, and threat model.
- [docs/ops](docs/ops): CI, release, rollback, and npm publishing policy.
- [docs/ops/runtime-recipes.md](docs/ops/runtime-recipes.md): snapshot replacement, shutdown,
  audit backpressure, and multi-process runtime guidance.
- [VALIDATION.md](VALIDATION.md): stable validation commands.
