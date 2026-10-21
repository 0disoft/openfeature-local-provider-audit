# Package, License, and Runtime Policy

Status: Accepted
Owner: 0disoft

## Context

The project needs implementation-facing decisions before package skeleton work starts.
The owner approved the recommended defaults for license, package name, runtime scope, and
OpenFeature SDK dependency policy.

## Decision

- License: Apache-2.0.
- Primary npm package name: `@0disoft/openfeature-local-provider`.
- MVP runtime target: server-side Node.js only.
- Initial Node.js support matrix: Node.js 22 LTS and Node.js 24 LTS.
- OpenFeature SDK dependency policy: `@openfeature/server-sdk` is a peer dependency, not a bundled runtime dependency.
- Package name does not include `audit`; audit remains a built-in capability and compatibility contract.
- Browser, Bun, Deno, and multi-language support are deferred until separate validation proves them.

## Consequences

- A root `LICENSE` file records Apache-2.0 now.
- Package skeleton work must use the approved package name.
- Runtime compatibility claims are backed by Node.js 22 and 24 CI checks.
- Consumer examples must install OpenFeature explicitly through the peer dependency path.
- Adding runtime support or bundling OpenFeature directly requires a new ADR or an update to this one.

## Review Blockers

- Package metadata uses a different package name without owner approval.
- The provider declares `@openfeature/server-sdk` as a regular dependency instead of a peer dependency.
- Browser, Bun, Deno, or Node versions outside the accepted matrix are documented as supported without tests.
- Release metadata omits Apache-2.0 license information.

## P3 portable boundary (alpha.18)

ADR 0015 authorizes a separate `/core` evaluation/JSON entry with platform-neutral
types and a bundled maintained SHA-256 implementation. The package root and
OpenFeature provider remain Node 22/24 only. Separating this code does not itself
promote browser, Bun, Deno or Workers into the support matrix; each requires actual
packaged runtime execution. The existing peer policy and Node engines stay intact.

## P3 runtime acceptance (2026-10-22 KST)

Actual packed alpha.18 core ESM now passes the same 1,449 evaluations and three
parse errors as native Node on Chromium 149.0.7827.55, Bun 1.4.3, Deno 2.9.6 and
native workerd 2026-10-19, all on Windows x64. Workerd explicitly disables both
Node compatibility modes at compatibility date 2026-10-19; browser and worker
assert Node process/Buffer/require globals are absent. Deno runs without granted
OS/network/env/subprocess permissions. This promotes only the /core JSON/evaluation
surface into the verified matrix in docs/library/compatibility.md. Package-root
OpenFeature provider, transport, audit, file and CLI APIs remain Node 22/24 only.
Other browser engines, platforms, runtime versions and production Cloudflare
account deployment are not established by this evidence. Existing Node engines,
server-SDK peer and Apache-2.0 identity are unchanged. Re-run the opt-in local
smoke for dependency/runtime upgrades; do not add recurring hosted CI cost here.
