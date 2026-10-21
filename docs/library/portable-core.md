# Portable evaluation core

Status: accepted P3 implementation contract under ADR 0015; runtime support pending.

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
