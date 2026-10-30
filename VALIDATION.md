# Validation

Status: Draft

## Validation Source of Truth

This document owns stable validation names for this local OpenFeature provider package.
Executable validation now runs through pnpm package scripts.

## Standard Validation Names

- format
- lint
- typecheck
- test
- coverage
- contract
- schemas
- migration-check
- stable-release-gate
- registry-smoke
- smoke
- docs
- check

## Required Final Report

Final responses must list executed validations, passed validations, skipped validations, skip reasons, and remaining risk.

## Runner Policy

The configured runner is pnpm. Runner command names must match this document.
Unconfigured runner commands must fail, not pass with a fake success.

## Runner Commands

- format: `pnpm run format:check`
- lint: `pnpm run lint`
- typecheck: `pnpm run typecheck`
- test: `pnpm run test`
- coverage: `pnpm run test:coverage`
- contract: `pnpm run contract`
- schemas: `pnpm run schemas:check`; also runs before both test commands used by CI.
- migration-check: `pnpm run migration-check`
- stable-release-gate: `pnpm run stable-release-gate`
- registry-smoke: `pnpm run registry-smoke`
- smoke: `pnpm run build` and `pnpm run pack:check`
- Explanation hash benchmark (targeted, optional): `pnpm benchmark:explanation`;
  builds then compares repeated snapshot hashing on fixed local workloads without
  disk/network I/O in timed sections. See `docs/library/audit-event-v1.md`.
- Portable adoption example: `pnpm run smoke:core-example`; builds and runs the
  private core-basic preview. The existing contract also copies its unchanged
  source into a real tarball-installed consumer and executes it there.
- Portable runtime smoke: `pnpm run smoke:core-runtimes`; serially packs and runs
  the same artifact/corpus on Bun, sandboxed Deno, real headless Chromium and local
  workerd without Node compatibility flags. Requires installed Bun, Deno and Chromium;
  CORE_BROWSER_BINARY, CORE_BUN_BINARY and CORE_DENO_BINARY select local executables.
  Workerd and Playwright Core are dev tools. Temporary loopback fixtures shut down.
  Optional runtime list is forwarded after the script name; no hosted CI added.
- GitOps recipe smoke (targeted, optional): `pnpm run smoke:gitops`; creates and removes
  ephemeral loopback TLS/key/recovery/audit artifacts and requires OpenSSL. It does
  not provision a service or add a hosted workflow.
- Static review browser smoke (targeted, optional): `pnpm run smoke:review-html`;
  builds then generates an HTML report through the real CLI and opens it with
  Playwright Core at desktop/mobile widths. Checks keyboard details, meters,
  no external requests and hostile-identifier escaping. Requires installed Edge
  on Windows or a locally installed Playwright Chromium elsewhere;
  `REVIEW_BROWSER_BINARY` selects another local Chromium executable. No download,
  web server or hosted CI job is added. Screenshots/report are ignored under
  `output/playwright/`; temporary inputs and the browser are closed in finally.
- Application lifecycle smoke (targeted, optional): `pnpm run smoke:lifecycle`;
  builds then executes the existing private Node example with the shared owner,
  actual file watcher/audit and named OpenFeature domains. Covers concurrent startup,
  retry, shutdown racing startup, close failures and 32 flushed redacted records.
  No server, signal handler, framework dependency or hosted workflow is started.
  NestJS/Next.js snippets are integration guidance, not full framework runtime proof.
- docs: `pnpm run release-readiness`
- check: `pnpm run check`

CI builds once per job, then runs typecheck:built, api:check:built,
pack:check:built and packed-smoke:built serially against those unchanged artifacts.
These explicit reuse commands require a prior successful build in the same checkout;
they do not establish freshness on their own. The standalone commands above retain
their build behavior. packed-smoke:built still packs and installs the actual tarball,
rejects absent build entries and cannot be combined with registry smoke.

Node 26 qualification reuses these same configured commands. The compatibility
workflow's optional boolean `qualify_node26` selects Linux, Windows and macOS with
`max-parallel: 1`, one build per platform, the full coverage/consumer gates and
file/lifecycle/GitOps examples. Its default and scheduled mode remain the existing
Linux packed-consumer probe plus the Node 24 peer check. Qualification must be
manually selected; editing this workflow does not execute it or widen Node engines.
See `docs/testing/node-26-qualification.md` for local evidence and pending platforms.

Optional local Linux qualification: `pnpm run qualify:linux-vm` requires a verified
QEMU executable (`QUALIFY_QEMU_BINARY`) and Debian 12 nocloud x64 qcow2 image
(`QUALIFY_LINUX_IMAGE`). It boots one disposable snapshot with 2 CPUs/4 GiB,
exports committed HEAD from existing main (excluding uncommitted edits), and runs
the same sequential Node 26 gates inside actual Linux. The runner installs only
inside the disposable guest, forwards no guest port or host filesystem mount,
logs to a reported temporary directory, and terminates its QEMU child after at
most 20 minutes. WHPX falls back to software emulation if unavailable; emulated
timings do not establish performance. No host installer, OS feature change,
credential, hosted CI dispatch, push or deployment is involved. A temporary
loopback-only serial socket closes with the VM. A missing guest
success marker is a failure, even if QEMU exits cleanly. This cannot verify macOS.

## Hygiene Validation

Repository hygiene file changes must check line-ending churn, binary diff pollution,
tracked secret files, ignored build/cache artifacts, and generated-output drift.

Intentional customization of generated scaffold documents may appear as `.ssealed`
checksum drift. Report that drift explicitly; do not update the generated manifest unless
the owner asks to rebaseline the scaffold.

## Scope

backend validation routes must stay stack-neutral unless a runner file explicitly defines a command.

## Repository Shape

library, sdk validation must stay repository-shape focused and must not imply generated application source code.

## Project-Specific Evidence

- docs: product, library, SDK, architecture, backend, ops, and engineering documents agree on the local-provider boundary.
- contract: public API docs identify bucketing, reason names, env override priority, audit event fields, and replay fixtures as compatibility-sensitive.
- security: privacy and threat-model docs confirm raw context, secrets, and evaluated object values are not logged by default.
- test: contract and replay tests cover default-return behavior, redaction, and deterministic bucketing.
- check: repository hygiene confirms no unowned API server, DB schema, secret, or generated output is treated as source truth.

The build command serially builds the Node package and the neutral `/core` entry.
The existing contract gate also checks the reviewed core ESM/CJS API baseline and
actual packed core consumers with strict ES2022-only (no Node ambient types)
TypeScript 5.9.3 and 7.0.2. This is package/Node evidence, not non-Node runtime proof.
