# Node.js 26 qualification

## Support decision

Node.js 26 is LTS according to the [official release table](https://nodejs.org/en/about/previous-releases).
The local Windows checks below are qualification evidence, not promotion of the
package's supported runtime range. Node.js 22/24 remain supported and
`engines.node` remains `>=22 <25` until Linux, Windows and macOS qualification passes.
No package runtime behavior, public export, dependency range or published version
changes as part of this test correction.

## Repeat the full cross-platform qualification

The existing [compatibility workflow](../../.github/workflows/compatibility.yml)
has a manual boolean input, `qualify_node26`, defaulting to `false`. On a revision
containing the candidate fixes, select it to run Linux (`ubuntu-latest`), Windows
(`windows-latest`) and macOS (`macos-15`) sequentially with `max-parallel: 1`.
Every lane records the actual Node 26 LTS version/platform, uses the frozen
lockfile, builds once, and runs format/lint, typecheck, API checks, full coverage,
migration/release/pack gates, real file reload, lifecycle and signed GitOps examples,
then the actual tarball consumer with the latest compatible peer.

The default/manual-unselected and weekly modes keep the previous two Linux jobs:
Node 24 peer compatibility and Node 26 packed-only compatibility. Full qualification
skips the redundant Node 24 peer job and adds no automatic per-push or scheduled
platform runs. Workflows have read-only repository permissions and no publishing
steps. Record the candidate commit, each job URL, actual versions, failures and
platform skips before considering promotion. A prepared workflow is not execution
evidence; no full hosted run is claimed here.

## Windows execution, 2026-10-30 KST

- Source: local `main` after `09d6502`, including the allocator-independent
  `snapshot-store-buffers.test.ts` correction recorded with this document.
- OS: Windows x64, build 10.0.26200; Node.js `v26.13.0`, LTS `Lithium`.
- Runtime: official `node-v26.13.0-win-x64.zip`, verified against the HTTPS-delivered
  [SHASUMS256.txt](https://nodejs.org/dist/v26.13.0/SHASUMS256.txt), SHA-256
  `dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a`.
- Node was extracted into ignored local Git state; the machine's default Node
  `v24.14.0` and global package installation were not changed. A process-local PATH
  and pnpm shim selected the Node 26 binary for nested package scripts and consumers;
  `pnpm exec node --version` also reported `v26.13.0`.
- pnpm `12.16.1`, TypeScript `7.0.2`, Vitest `5.0.5`, workspace OpenFeature server
  SDK `1.23.0`; existing dependencies/lockfile were used without an upgrade.

| Validation | Result |
| --- | --- |
| `pnpm run check` | Passed: typecheck/build, schemas, coverage, API, migration, release gate, pack validation and readiness |
| Library coverage suite | 96 files; 1,358 passed, 11 platform-conditional skips, zero failures |
| Coverage | 95.47% statements, 93.72% branches, 98.23% functions, 96.94% lines |
| Script suites inside `check` | API tools 4, benchmark tools 9, migration tools 7, release tools 53 passed; migration tools also rerun by the migration gate |
| `OPENFEATURE_SERVER_SDK_VERSION=peer pnpm run packed-smoke:built` | Passed on Node 26; real 612,902-byte local tarball, ESM/CJS, declarations, `/core`, schemas, CLI, provider/replay/watch/audit/recovery contracts |
| Packed consumer TypeScript | 5.9.3 full-library checking and 7.0.2 consumer-surface checking passed |
| `pnpm --filter openfeature-local-provider-node-basic-example start` | Override, rollout, replay and real file reload passed; three strictly redacted audit events |
| `pnpm run smoke:lifecycle` | 32 concurrent clients shared one startup/close; 32 records flushed; unrelated OpenFeature domain remained usable |
| `pnpm run smoke:gitops` | Signed releases 1/2/3, rollback, restart recovery, one conditional hit, two rejected updates, ten evaluations without fetch and 15 audit events passed |
| `pnpm run format:check` / `pnpm run lint` | Passed; lint retained four existing warnings and two informational notices |
| Node 24 regression check | All eight `snapshot-store-buffers.test.ts` cases passed on `v24.14.0` |

The packed smoke selects the latest SDK allowed by the existing `^1.22.0` peer
range. It does not change that range or establish that every historical peer
version was tested on Node 26. Platform skips include POSIX-specific path/link and
Linux-native watch cases; they are not cross-platform passes. Generated logs,
runtime archives, coverage and build output are not tracked evidence sources.

## Failure found and corrected

The first Node 26 coverage run had three failures, all in the recovery input-buffer
allocation assertion. Recovery itself succeeded: the 423-byte signed journal
requested one 424-byte buffer for read caps of 1, 7 and 65,536 bytes. Its shared
backing store was 65,600 bytes, exceeding `Buffer.poolSize` (65,536) by 64 bytes.
Node 26's [Buffer implementation](https://github.com/nodejs/node/blob/v26.13.0/lib/buffer.js)
aligns and over-allocates the pool; its private backing length is not our contract.

The test now retains the exact requested-capacity assertion and checks that every
short read reuses one backing store. It still measures backing bytes, without
equating the runtime's private allocator size to the public pool setting. File
growth/shrinkage, exact maxBytes, one-byte overflow, UTF-8 and handle-close checks
remain in the same suite. No production buffer or file-read logic was changed.

## Remaining qualification

Linux and macOS Node 26 runs have not been executed in this local session. The
machine has no verified usable Linux/macOS runner; a WSL listing did not return and
was stopped. No GitHub workflow was dispatched, code pushed or package published.
Keep the support gate in [compatibility](../library/compatibility.md) until actual
cross-platform checks on the same candidate revision are available. A local
Windows success or the existing Linux packed-only probe alone is insufficient.
