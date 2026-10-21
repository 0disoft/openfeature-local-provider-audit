# ADR 0012: TypeScript 7 Declaration Toolchain

Status: Implemented
Owner: 0disoft

## Context

[Issue #13](https://github.com/0disoft/openfeature-local-provider-audit/issues/13)
tracks declaration generation failing after a version-only TypeScript 7 upgrade.
The old `tsup@8.5.1` declaration path embeds a JavaScript compiler API that TypeScript
7 no longer provides. `tsup@9` still does not provide the required native declaration
path. The [tsup maintainers recommend tsdown](https://github.com/egoist/tsup).

## Decision

- Replace tsup with `tsdown`, which uses Rolldown and `rolldown-plugin-dts`.
- Explicitly select the plugin's native TypeScript 7 `tsgo` generator. Do not patch
  dependencies or enable `skipLibCheck` to hide declaration-build errors.
- Use `tsconfig.build.json` to check the source declaration graph with
  `skipLibCheck: false`; exclude tests from package declaration generation.
- Keep the ES2022 target, ESM/CJS runtime bundles, runtime sourcemaps, `index.d.ts`,
  `index.d.cts`, CLI entry names, and the package-root export map. Declaration maps
  are emitted as additional build artifacts. Internal hashed chunks remain private.
- Use TypeScript 7 for repository type checks and current packed-consumer fixtures.
  Keep the TypeScript 5.9.3 strict ESM/CJS fixtures covering every public type.
- Retain TypeScript 6 under the explicit development-only `typescript-api` npm alias
  solely for API-baseline analysis. It does not emit package declarations. The API
  comparator ignores the equivalent inline-versus-list `export` spelling while still
  checking export names, type/value spaces, signatures, and supporting declarations.
  The source-owned API baseline remains unchanged.

The native generator is documented by
[rolldown-plugin-dts](https://github.com/sxzz/rolldown-plugin-dts/blob/main/src/options.ts).
Its warning about TypeScript 7's experimental programmatic API remains visible; this
project uses the compiler executable for generation and the explicit older API alias
for its existing AST analysis.

## Dependency And Artifact Review

`tsdown` is MIT licensed, Rolldown is MIT licensed, and TypeScript is Apache-2.0.
TypeScript 7 and Rolldown add platform-specific native optional packages for supported
Windows, macOS, and Linux hosts. Frozen-lockfile installs must retain optional platform
packages; no third-party source is patched. These are build dependencies, not bundled
provider runtime dependencies. YAML remains the runtime dependency and OpenFeature
remains a peer. Package checks and the existing 1 MiB tarball budget remain mandatory.

The build tool requires Node 22.18+ or 24.11+ for development; released provider support
remains Node 22/24. CI uses the current versions of those majors. Do not conflate the
build-host minimum with a consumer engine-range change.

## Validation And Rollback

Run format, lint, typecheck, contract (unchanged API baseline and packed ESM/CJS/type/CLI
consumers), migration-check, pack:check (publint and Are the Types Wrong), and
release-readiness. The existing six-platform/runtime CI matrix must pass after these
commits are pushed; local Windows evidence cannot establish new hosted results.

The last TypeScript 6 build combination was `tsup@8.5.1` with `typescript@6.0.3`.
Commit `0d7b528` retains that combination immediately before this migration. To roll
back the toolchain, restore its package manifests, lockfile, compiler-API import, and
package build command together, remove the new build configs, and rerun the same
contract and package checks. Do not regenerate the public API baseline to hide drift.
