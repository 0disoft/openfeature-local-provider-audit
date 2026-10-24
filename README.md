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
- Optional operational status, audit failure policy and caller-owned OpenTelemetry metrics.
- Caller-triggered HTTPS signed snapshot delivery, durable recovery and GitOps recipes.
- Optional chained audit storage, rotation and trusted-checkpoint verification.

These operations/integrity additions belong to the unpublished 2.0 checkout; see
the [P2 delivery record](docs/product/07-operations-and-integrity.md) and
[local acceptance evidence](docs/testing/p2-acceptance.md).

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

This checkout stages an unpublished v2 development prerelease. Read its exact
version from the [package metadata](packages/local-provider/package.json), rather
than an older runtime evidence record. New v2 features require building this
checkout; the stable install command above is not an installation of this preview. See [v2 targeting](docs/library/flag-file-schema-v2.md),
[inspection CLI](docs/library/local-inspection.md), and
[migration](docs/library/migration-to-2.0.md).

The [GitOps recipe](docs/library/gitops-snapshots.md) composes signing, durable
HTTPS refresh, restart recovery and rollback. Run its local HTTPS/OpenFeature proof
with `corepack pnpm run smoke:gitops`; it performs no external publication.

P3 includes [opt-in HMAC audit pseudonyms](docs/library/audit-pseudonyms.md).
Default events stay uncorrelated. The [P3 plan](docs/product/08-privacy-and-portability.md)
records completed local object storage, runtime portability and reproducible usage
material. Independent adoption evidence is excluded from P3 acceptance by the
owner's 2026-10-22 decision and remains unverified. The checkout
also supports [scheduled local rollout](docs/library/scheduled-rollout.md) with
explicit offline time and caller-owned provider clocks, without background timers.

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

The opt-in `/core` JSON/evaluation subpath has actual local runtime evidence on
Chromium, Bun, Deno and workerd. See [the scoped compatibility matrix](docs/library/compatibility.md)
and [the repeatable runtime smoke](docs/testing/core-runtime-acceptance.md).
Root provider/file/audit APIs remain Node 22/24 only.

For a complete runnable preview and stable-versus-local installation steps, see
[the adoption guide](docs/sdk/adoption-guide.md) and
[core-basic](examples/core-basic/README.md). Local examples and performance/runtime
receipts are maintainer evidence; independent external adoption remains unverified.
