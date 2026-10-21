# Portable core runtime acceptance

Executed 2026-10-21T16:09:47.537Z on Windows x64, Node controller v24.14.0.
Artifact: local unpublished 2.0.0-alpha.18. This evidence extends only /core,
not the Node OpenFeature provider, audit/file/CLI/source APIs or cloud deployment.

`pnpm run smoke:core-runtimes` builds then packs the package and tests its exact
core ESM bytes. Install Bun, Deno and Chromium separately; optionally select them
with CORE_BUN_BINARY, CORE_DENO_BINARY and CORE_BROWSER_BINARY. Playwright Core
and native workerd are dev tools. CORE_RUNTIME_REPORT optionally saves a receipt;
check the command exit status and capturedAt because receipts record successful
runs. A positional comma-separated runtime subset is diagnostic, not full acceptance.

| Actual runtime | Version | Result |
| --- | --- | --- |
| Bun | 1.4.3 | 1449 evaluations + 3 parser failures matched native Node |
| Deno | 2.9.6, V8 15.0.245.2 | Same result digest; no OS/network/env/run permissions granted |
| Real Chromium | 149.0.7827.55 | Same result digest; Node globals absent |
| Native workerd | 2026-10-19 | Same result digest; Node globals absent |

The shared corpus covers all four flag types (including nested object/null), v1/v2,
immutable JSON parsing, Unicode and malformed UTF-16, seeded rollout, semver
conditions, overrides, emergency disable, missing/type/context errors, and explicit
schedule boundaries/backwards time. Results include reasons, buckets, variants,
metadata and error codes. Native Node's existing SHA-256 evaluator is the reference;
independent final-stage/disable/immutability/parser assertions also run in each VM.
No missing runtime or mismatching result is silently skipped.

Workerd compatibility date is 2026-10-19 with both no_nodejs_compat and
no_nodejs_compat_v2. Current compatibility dates enable Node modes by default;
[Cloudflare's documented disable flags](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)
are explicit in the fixture. Workerd is spawned directly as a native child (not an
intermediate shell), its response has a per-fixture identity header, and it closes
before the next runtime/process starts. Browser and server also close in finally;
loopback sockets and temporary extracted artifacts are removed on failure/success.

Tarball SHA-256: `240b4bc983abfcd8631deccb7054a18748149466de2b91595cf247e13e40b669`.
Core ESM SHA-256: `34bedfcb5f7f81739803ced4bfef5f6f65254623b4f74b7e551c3cfaa453ee67`.
Full result SHA-256: `e1aa3374784f8f712918d60fc7231c8e8e7c263d6c5ca264457375fc508130de`.
Machine-readable receipt: [core-runtime-evidence.json](core-runtime-evidence.json).
Hashes identify this run, not a published npm artifact or user adoption evidence.

Not established: Firefox/WebKit/Safari, other host OS/runtime versions, long-running
production load, hosted Cloudflare routing/accounts, or an external adopter. No
push/deploy/hosted workflow is performed. Existing Node engine/peer/runtime package
dependencies are unchanged; Playwright Core/workerd are Apache-2.0 dev tools.
Workerd's postinstall is explicitly disabled: its verified optional platform binary
is already present and resolved directly, with no secondary installer needed.
Deno is an external executable; pnpm devEngines was not changed to select it.

The missing-browser negative execution also failed visibly with ENOENT and left
no temporary fixture directory or loopback listener. No validation was silently skipped.
