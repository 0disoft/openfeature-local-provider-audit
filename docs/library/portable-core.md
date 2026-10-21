# Portable evaluation core

Status: implemented locally in alpha.18; core runtime matrix verified on 2026-10-22 KST.

Expose @0disoft/openfeature-local-provider/core as a deliberate ESM/CJS subpath.
It provides synchronous evaluateFlag and parseJsonFlagSnapshot, LocalProviderError,
isLocalProviderError, LOCAL_PROVIDER_ERROR_CODES, EVALUATION_REASONS and
EVALUATION_SOURCES, with only their platform-neutral dependent types.
It does not expose the Node OpenFeature provider, I/O, audit, process environment,
YAML loader, explanation hashing or persistence. Pass explicit overrides/context/time
as evaluation request data. Loading the core must perform no I/O or background work.
Do not send server-only secrets or targeting configuration to public clients.

The shared evaluator keeps identical v1/v2 targeting, semver, rollout, schedule,
errors and metadata semantics. Inject only the internal bucket computation boundary:
Node retains native SHA-256; core uses the maintained MIT-licensed @noble/hashes
SHA-256 implementation, not a new handwritten hash. UTF-8 encoding, first eight
big-endian digest bytes and modulo 100000 remain byte-for-byte compatible,
including Unicode and replacement encoding of malformed UTF-16. No crypto choice
is configurable through public evaluation inputs. No bucket caching/global mutation.

Bundle the portable dependencies into its artifact; emitted declarations must not
require Node globals or OpenFeature SDK types. Keep the package root's existing
Node 22/24 support, exports and consumers intact. Record the new subpath and its
reviewed declaration/runtime surface, package contents, dependency licenses and
consumer type checks. Existing root imports remain Node-only.

Before claiming browser/Bun/Deno/Workers support, execute the actual packaged core
in each real runtime against the same deterministic v1/v2/Unicode/targeting/schedule
corpus, with no Node compatibility/polyfill assumptions. A successful bundle, VM
sandbox or Node test alone is insufficient. Browser/Worker visibility and runtime
version evidence belong in an explicit update to ADR 0004 and the compatibility
matrix. Production Cloudflare account deployment is not authorized or required
for a local workerd execution claim. Independent adoption remains separate.

## Types and use

The subpath exports FlagType, JsonValue, JsonObject, FlagValue,
PercentageRolloutRule, FlagDefinition, ConditionScalar, ScheduledRollout,
ScheduleEvaluation, TargetingCondition, TargetingRule, FlagSnapshot,
EvaluationRequest, EvaluationContext, EvaluationResult, EnvOverrideState,
LocalProviderErrorCode, EvaluationReason and EvaluationSource. LocalProviderError
also occupies the type namespace. Root types remain structurally identical.

```ts
import { parseJsonFlagSnapshot, evaluateFlag } from "@0disoft/openfeature-local-provider/core";
const snapshot = parseJsonFlagSnapshot(configJson);
const result = evaluateFlag(snapshot, {
  flagKey: "checkout.enabled", expectedType: "boolean", defaultValue: false,
  targetingKey: explicitSubject, evaluationTime: Date.now()
});
```

Callers bound/verify config bytes before JSON parsing, own time and targeting trust,
and pass already-loaded snapshot/request objects. No implicit environment access
or remote fetching occurs. The whole package retains its existing Node engines
and server-SDK peer declaration; the subpath's runtime and declarations do not
load that peer. Provider registration still imports the package root on Node.

The configured build runs the existing Node build first, then a separate neutral
core build serially. This keeps Node dependencies/native hashing separate and
emits self-contained core ESM/CJS declarations and code. Core bundles noble hashes
and semver; THIRD_PARTY_NOTICES ships their MIT/ISC notices. Root YAML/SDK behavior
and dependencies remain unchanged. api/local-provider-core.api.d.ts is reviewed
with the existing api:check gate; package-root API remains 114 exports / 32 values,
core is 26 exports / 7 values. Packed consumers compile core with ES2022 and
no Node type libraries using strict TypeScript 5.9.3 and 7.0.2.

The bundled hash package is a development dependency; Node consumers acquire no
new runtime dependency. Legacy TypeScript subpath resolution is covered by the
package typesVersions mapping. Runtime-specific execution evidence is recorded in `../testing/core-runtime-acceptance.md`.
Support is limited to that core-only runtime/host matrix.

## Reproduce runtime acceptance

Run `pnpm run smoke:core-runtimes` after installing Bun, Deno and a local Chromium.
`CORE_BUN_BINARY`, `CORE_DENO_BINARY`, `CORE_BROWSER_BINARY` can select explicit
executables; Playwright's installed Chromium is the default browser. The script
never downloads browsers or changes the project's Node runtime. Workerd and
Playwright Core are development tools. `CORE_RUNTIME_REPORT` optionally saves the
machine-readable package/core/result hashes and exact versions. A positional list
such as `browser,workerd` runs only that subset and is not full-matrix acceptance.

The controller packs and extracts the actual package, copies its exact core ESM
bytes into an isolated fixture and compares the same shared corpus with native
Node evaluation. Bun/Deno import the standalone bytes; Deno grants no read/write,
network, environment or subprocess permissions, uses no npm/config/lock file and
never prompts. The real browser loads modules over loopback. Native workerd runs
the same modules with no Node globals and explicit no_nodejs_compat /
no_nodejs_compat_v2 flags at its current compatibility date. Workers defaults
changed after 2026-08-04, so an empty positive flag list is insufficient to prove
this boundary. See [Cloudflare's explicit disable instructions](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/).

Every selected runtime must match all 1,449 results and three parser error records;
no missing runtime is silently skipped. Native child processes are bounded and
owned, fixtures bind loopback only, and browser/server/workerd/temp files close on
success or failure. The local workerd socket uses an ephemeral port reservation;
a competing bind fails visibly rather than silently testing a different port.
No deployment, account credentials, remote flag requests or hosted CI is involved.
