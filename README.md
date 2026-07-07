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
- Typed OpenFeature evaluation for boolean, string, number, and object values.
- Explicit per-flag environment overrides.
- Deterministic percentage rollout with replayable bucketing.
- Redacted audit event generation and optional JSON Lines file sinks.
- Replay fixtures for compatibility-sensitive evaluation behavior.

## What It Does Not Own

- Hosted flag management.
- Remote control planes, streaming updates, dashboards, or approval workflows.
- User segment databases or experiment analytics.
- Browser, Bun, Deno, HTTP API, database, Kubernetes, or Terraform runtime support.

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
- [VALIDATION.md](VALIDATION.md): stable validation commands.
