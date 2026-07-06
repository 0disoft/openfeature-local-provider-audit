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
- Runtime compatibility claims must be backed by Node.js 22 and 24 checks once a runner exists.
- Consumer examples must install OpenFeature explicitly through the peer dependency path.
- Adding runtime support or bundling OpenFeature directly requires a new ADR or an update to this one.

## Review Blockers

- Package metadata uses a different package name without owner approval.
- The provider declares `@openfeature/server-sdk` as a regular dependency instead of a peer dependency.
- Browser, Bun, Deno, or Node versions outside the accepted matrix are documented as supported without tests.
- Release metadata omits Apache-2.0 license information.
