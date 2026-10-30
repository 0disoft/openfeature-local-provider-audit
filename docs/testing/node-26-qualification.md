# Node.js 26 qualification

## Support decision

Node.js 26 is LTS according to the [official release table](https://nodejs.org/en/about/previous-releases).
The local Windows and Linux checks below are qualification evidence, not promotion of the
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

## Linux execution, 2026-10-30 KST

- Source: committed local `main`, `05542603a0bb90ae125688890b7fa50878ceb1fb`.
  The new host/guest verification fixture was read from the working tree; product
  code and the gates ran from that commit's clean `git archive`, SHA-256
  `dc38c0ac5793b2e7719200af3f83ce83e610edd9efb051fc3011629f05bc56b5`.
- OS: actual Debian GNU/Linux 12 (bookworm), x64; kernel `6.1.0-54-amd64`,
  Debian `6.1.190-1`. Native Linux filesystem/watch behavior was not simulated by
  overriding Node's platform value. Guest tests ran as root.
- Runtime: Node.js `v26.13.0`, LTS `Lithium`, pnpm `12.16.1`. The official
  `node-v26.13.0-linux-x64.tar.xz` matched its SHA-256 list:
  `d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997`.
- Host fixture: portable QEMU `11.1.0` with WHPX, 2 virtual CPUs, 4 GiB RAM,
  a disposable disk snapshot and a read-only source disk. The Windows QEMU
  installer was extracted without running it, and matched the maintainer's
  [SHA-512 list](https://qemu.weilnetz.de/w64/qemu-w64-setup-20260811.sha512).
- The [Debian 12 nocloud image](https://cloud.debian.org/images/cloud/bookworm/latest/)
  matched the HTTPS-delivered SHA-512 list:
  `3b7c3342105085c60097147c7f7491e761c115170213ba7d9c87685e32d234bdafe0ddf8d6fd6600a6a837c761fa229ce8b9fe2086d1235f8eebeb778d05b977`.
  Its checksum was unchanged after the VM exited. Both latest-image URLs and
  latest 26.x resolution can change; record fresh hashes when repeating a run.

| Validation | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed inside the Linux guest |
| Format, lint, build, `typecheck:built`, `api:check:built` | Passed; API 127 exports/35 values, core 26 exports/7 values; four existing lint warnings and two notices |
| `test:coverage` | 96 files passed; 1,364 tests passed, five Windows-only skips, zero failures |
| Coverage | 95.67% statements, 93.72% branches, 98.67% functions, 97.19% lines |
| Script suites | API tools 4, benchmark tools 9, migration tools 7 and release tools 53 passed |
| Migration, stable gate, `pack:check:built`, readiness | Passed; the migration gate also repeated its seven tool tests |
| Node example | Real file reload/override/rollout/replay passed; three redacted audit events |
| Lifecycle example | 32 concurrent clients, one shared startup/close, 32 flushed records and unrelated domain preserved |
| Signed GitOps example | Releases 1/2/3, rollback/restart recovery, conditional hit, two rejected updates, ten evaluations without fetch and 15 audit events passed |
| `OPENFEATURE_SERVER_SDK_VERSION=peer pnpm run packed-smoke:built` | Actual 612,914-byte local tarball installed and passed ESM/CJS/core/types/schemas/CLI/provider/watch/audit/recovery checks on Linux Node 26; TypeScript 5.9.3 full-library and 7.0.2 surface checks passed |
| VM result/cleanup | Explicit guest result 0 and QEMU exit 0; no QEMU child remained |

The five skips are the Windows polling-cleanup case, three Windows case-alias
queue cases, and Windows case-insensitive sparse-rotation matching. Linux path,
link and native directory-watch tests ran. No provider production change was
needed. Host WSL probes did not respond within eight seconds and were stopped;
no WSL distribution or Windows feature was installed. The complete successful
guest boot/setup/gates/shutdown took about 192 seconds on this fixture; this is
validation duration, not an application latency or throughput benchmark.

## Remaining qualification

macOS still requires a real Mac or an existing macOS CI executor. This Windows
machine has no registered Mac SSH target; no new paid runner was provisioned.
The prepared qualification workflow cannot run unpublished local workflow edits:
GitHub dispatch uses a workflow on a remote ref. Pushing or updating that remote
ref is outside this local-only task. An existing Mac can instead receive a
`git archive HEAD` source archive and run the configured qualification commands;
this transfers committed source without pushing a branch. A mock of
`process.platform`, Linux emulation, or macOS cross-compilation is not execution
evidence for native macOS watcher/filesystem behavior.

Keep the support gate in [compatibility](../library/compatibility.md) until actual
cross-platform checks on the candidate runtime code are available. No GitHub
workflow was dispatched, code pushed or package published during local testing.

## Local Linux VM procedure

`pnpm run qualify:linux-vm` is an optional, bounded verification fixture, not
application runtime infrastructure. Supply an already verified QEMU executable
as `QUALIFY_QEMU_BINARY` and a Debian 12 nocloud x64 qcow2 as
`QUALIFY_LINUX_IMAGE`. It archives committed HEAD from the existing main branch;
uncommitted edits are explicitly excluded. Guest writes use QEMU snapshot mode,
and the source archive is attached read-only. No branch/worktree, WSL installation,
host shared directory, SSH credential or guest port forwarding is created. The
temporary serial console listens only on host loopback and closes with the owned
QEMU child. Each attempt has a 20-minute limit; an absent/nonzero guest result is
a failure, independently of QEMU's exit code. The reported temporary directory
retains the source archive and full console log for inspection.

The guest resolves the latest 26.x from the official Node index, verifies its
Linux x64 archive against that release's HTTPS SHA-256 list, checks the actual
Linux platform/26 major/LTS metadata, installs the frozen lockfile, and executes
the existing CI gates serially. Build reuse matches the compatibility workflow.
The Windows host's installed Node and package manager are not changed. QEMU's
WHPX accelerator can fall back to software emulation; these runs do not establish
production throughput or latency.

The first Debian 13 image stopped at interactive first-boot setup, so the fixture
uses the Debian 12 nocloud image with its intended local root console. Its first
Node 26 start exposed a missing `libatomic.so.1` (exit 127), before any package
test ran. The guest now installs `libatomic1` explicitly. This is a documented
[Node 26 Linux runtime prerequisite](https://github.com/nodejs/node/blob/v26.13.0/BUILDING.md),
not a provider defect: official Linux binaries have linked libatomic since Node
25. Minimal Linux installations need the corresponding distribution package;
an existing richer CI image may already include it. The disposable image runs
tests as root; results do not establish non-root installation/permission behavior.
