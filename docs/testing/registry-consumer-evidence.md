# Registry Consumer Evidence

Status: Published stable, historical candidate, and verified hosted evidence
Owner: 0disoft

This page records the current published release and the last published candidate as
historical publication evidence. The release
workflow verifies registry bytes and channels after publication; this record is updated only
from those public results.

## Current Published Release And Hosted Evidence (2026-10-29)

- Package: `@0disoft/openfeature-local-provider@2.0.0`, published through npm `latest`.
- Source/tag commit: `4a7628a75ac9f774de46296d745cf00e86f3140b` on main; tag `v2.0.0`.
- [Release run 40846556502](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40846556502)
  passed validation, npm publication, registry byte/channel verification, and GitHub publication.
- [GitHub Release v2.0.0](https://github.com/0disoft/openfeature-local-provider-audit/releases/tag/v2.0.0)
  is non-draft and selected as GitHub `Latest`. The public latest-release endpoint and
  npm dist-tag were verified after publication.
- The tested artifact, npm tarball, and downloaded GitHub asset are all 587,111 bytes,
  SHA-256 `34609e8feaf1ea71dc4ca8de6ab94ad654606fe22c3c218369d24ed1ec48222a`.
  npm supplies provenance attestations for the published package.
- [Main CI run 40846556603](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40846556603)
  passed all six Node 22/24 lanes across Linux, Windows, and macOS.
- [Registry consumer run 40846909742](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40846909742)
  installed exact `2.0.0` from npm on Linux, Windows, and macOS. All three lanes reported
  `registry-consumer-smoke-passed`, full-library TypeScript `5.9.3`, and consumer-surface
  TypeScript `7.0.2`. This validates the published package rather than a workspace link.
- Local checks on Windows/Node 24.14.0 passed format, lint, the full `check`, the Node
  example, packed consumers, and the Bun/workerd core corpus. Provider tests reported
  1,340 passed and 11 platform-conditional skips. Lint retained four existing warnings
  and two informational findings; no runtime implementation or workflow changed here.
  Deno/Chromium and the OpenSSL-dependent GitOps smoke were not repeated for this
  metadata/documentation release; their earlier receipts keep their original scope.

## Historical Published Candidate And Hosted Evidence (2026-10-29)

- Verified npm channels: `latest=1.0.0`, `next=2.0.0-alpha.124`.
- Candidate main commit: `d4d15ba9b89dd2f67890f90fcb0e193d0df89bf3`.
- [Release run 40840754532](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40840754532)
  completed successfully and created the prerelease
  [v2.0.0-alpha.124](https://github.com/0disoft/openfeature-local-provider-audit/releases/tag/v2.0.0-alpha.124).
  npm initially reported processing; the three-minute verification window expired with
  HTTP 404. Read-only reconciliation subsequently matched the tested candidate. The
  resumed workflow skipped `npm publish`, verified registry bytes and created the release.
- npm and GitHub tarballs are both 587,864 bytes, with SHA-256
  `a34bb72b5099926d32f44b8101266461550c8a775e9312e072d0e70b56d7c374`.
- [Registry consumer run 40841612127](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40841612127)
  installed exact `2.0.0-alpha.124` from npm on all three platforms. Every job printed
  `registry-consumer-smoke-passed`, the digest above, OpenFeature server SDK `1.22.0`,
  full-library TypeScript `5.9.3` and consumer-surface TypeScript `7.0.2`.

| Runner | Platform | Node.js | Requested package |
| --- | --- | --- | --- |
| ubuntu-latest | linux-x64 | v24.22.1 | 2.0.0-alpha.124 |
| windows-latest | win32-x64 | v24.22.1 | 2.0.0-alpha.124 |
| macos-15 | darwin-arm64 | v24.20.0 | 2.0.0-alpha.124 |

[Main CI run 40840754460](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40840754460)
passed all six Node 22/24 and Linux/Windows/macOS lanes at the candidate commit,
including TypeScript 7 declaration builds and packed consumers. The initial
[registry run 40840754456](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40840754456)
passed all three `latest=1.0.0` lanes but failed its three `next` lanes because its
plan captured the older `2.0.0-alpha.103` before publication. It is not a successful
six-lane run; the exact-version run above supplies the new candidate evidence.

This evidence identifies the published candidate, not later checkout builds with
updated development dependencies. The stable and pre-1.0 records below remain historical.

## Historical 1.0 Release

- Package: `@0disoft/openfeature-local-provider@1.0.0`.
- npm channel: `latest`; npm `next` remained `1.0.0-rc.2`.
- GitHub Release: [v1.0.0](https://github.com/0disoft/openfeature-local-provider-audit/releases/tag/v1.0.0),
  published as a non-draft stable release on 2026-07-20.
- Release workflow run:
  [29720564101](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29720564101),
  completed successfully.
- npm and GitHub Release tarball size: 98,574 bytes each.
- SHA-256 for both public tarballs:
  `bbcbbb6ec60b55262800d82ebeb5bd4af1fd659fdd6ddc8c8a4ebe11344293c0`.
- npm integrity:
  `sha512-AxPAeIqnlKdRiiVQczJICwWLB82TnxSSSDv6bHQDF8TABnaRS67ZLn9vJ7AJqwrS3uJDccj3EINhkya1AZ6gwA==`.
- Normal-registry `latest` smoke passed on Windows x64 with Node.js `v24.18.0`,
  `@openfeature/server-sdk@1.22.0`, strict TypeScript `5.9.3`, and consumer-surface
  TypeScript `6.0.3`.

## Historical Pre-1.0 Candidate

- Package: `@0disoft/openfeature-local-provider@1.0.0-rc.2`.
- At candidate publication: npm channel `next`; npm `latest` still resolved to `0.16.0`.
- Historical verified tags on 2026-10-21: `latest=1.0.0`, `next=1.0.0-rc.2`; the
  candidate is superseded by stable and is not an active next-release series.
- GitHub Release: `v1.0.0-rc.2`, marked as a prerelease.
- Release workflow run: [29712977031](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29712977031),
  completed successfully on 2026-07-20. The candidate size, digest, and integrity below
  identify the artifact from that release, not a current checkout build.

## Candidate Artifact Identity

- npm tarball size: 98,580 bytes.
- GitHub Release tarball size: 98,580 bytes.
- SHA-256 for both public tarballs:
  `fbc56fe6b5501d0e690a30b22cf413444a3268c05d67d3ad271f1570d8e7a4d0`.
- npm integrity:
  `sha512-yDDYu2n4B3cX22b2JW73QCXvL3ad1F/6OksjMTkiytHDDfAr6Ru/81KGpjm44BkVL+NMhXjRQEUhlMFWPSQFiA==`.

## Candidate Normal Registry Install

The repository-owned `registry-smoke` validation created a temporary consumer outside
the workspace and installed the exact package version by name from the normal npm
registry. It did not use a workspace link, checkout `dist`, or a local tarball.

- Result: `registry-consumer-smoke-passed`.
- Platform: Windows x64 (`win32-x64`).
- Node.js: `v24.18.0`.
- `@openfeature/server-sdk`: `1.22.0`.
- Full dependency declaration check: TypeScript `5.9.3`, `skipLibCheck: false`.
- Current consumer-surface check: TypeScript `6.0.3`, `skipLibCheck: true`.
- Runtime coverage: ESM, CJS, CLI, OpenFeature registration and evaluation, environment
  priority, replay, watcher reload, configuration-change events, audit redaction, audit
  sink flush, and shutdown.

## Historical Pre-1.0 Hosted Registry Matrix

- Workflow run: [38544144608](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/38544144608).
- Tested main commit: `607ec27fc4c310307fc98ff21ea841e7dc46be2c`.
- Date/result: 2026-10-14 UTC; all six jobs succeeded, including clean installs and
  `Consume published package`, with `registry-consumer-smoke-passed` in every log.
- Channels: `latest` resolved to `@0disoft/openfeature-local-provider@1.0.0`;
  `next` resolved to `@0disoft/openfeature-local-provider@1.0.0-rc.2`.
- Platforms and actual Node versions recorded in the runtime result:

| Runner | Platform | Node.js | Channels |
| --- | --- | --- | --- |
| ubuntu-latest | linux-x64 | v24.21.0 | latest, next |
| windows-latest | win32-x64 | v24.21.0 | latest, next |
| macos-15 | darwin-arm64 | v24.20.0 | latest, next |

Every job used OpenFeature server SDK `1.22.0`, strict TypeScript `5.9.3`, and
consumer-surface TypeScript `6.0.3`. These are historical hosted tool versions; the
local TypeScript 7 migration does not retroactively change the run's evidence.
This matrix includes rc.2; its hosted result is complete. The stale `next` tag is
historical candidate coverage, not evidence of an active candidate series.

## Latest Verified OpenFeature Peer Compatibility

- Workflow run: [40843867176](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/40843867176).
- Tested main commit: `0c9b26a242ef9f0ee8ae02570da3981f6f04f37d`.
- Date/result: 2026-10-29 UTC; the Linux latest-compatible-peer job succeeded on
  Node.js `v24.22.1`, using `OPENFEATURE_SERVER_SDK_VERSION=peer` and packed smoke.
- The log records TypeScript `5.9.3` full-library and `7.0.2` consumer-surface checks.
  The harness did not print the exact peer version resolved inside its temporary
  consumer, so this record does not infer one from the repository lockfile.
- The same run's Node 26 Linux canary passed on `v26.12.1`, including both compiler
  consumers and the latest compatible peer. Both jobs tested a fresh 587,152-byte
  checkout tarball after the development dependency refresh, not the published
  587,864-byte candidate above. This is experimental Node 26 evidence; official
  engine support remains Node 22/24.

## Historical rc.1 Hosted Registry Matrix

- Workflow run: [29648435330](https://github.com/0disoft/openfeature-local-provider-audit/actions/runs/29648435330).
- Tested commit: `ba4220d6195aa0e40ae823f3cfe82c1d8dfa7e94`.
- Result: all six Node.js 24 jobs completed successfully on 2026-07-18.
- Matrix: npm `latest` and `next` on `ubuntu-latest`, `windows-latest`, and pinned
  `macos-15`.
- Every job completed the clean dependency install and `Consume published package` step.
- `latest` covered `0.16.0`; `next` covered `1.0.0-rc.1`.
- This 2026-07-18 matrix predates `1.0.0-rc.2`. It remains historical evidence;
  the completed rc.2 and stable hosted matrix is recorded above.

## Cross-Repository Consumer

The published candidate is also installed in the separate
[`0disoft/service-catalog-generator`](https://github.com/0disoft/service-catalog-generator)
repository at commit `119b211f49e9a4824ab168fb4c92bce1a4655908`.

- Package spec: `@0disoft/openfeature-local-provider@1.0.0-rc.2`, resolved from the normal
  npm registry through the committed pnpm lockfile.
- OpenFeature peer: `@openfeature/server-sdk@1.22.0`.
- Consumer behavior: three boolean flags select JSON and HTML output while suppressing DOT,
  then the built SCG CLI compiles two services and the fixture verifies the generated files.
- Main CI run:
  [29716348265](https://github.com/0disoft/service-catalog-generator/actions/runs/29716348265),
  completed successfully on 2026-07-20.
- Additional successful runs:
  [action-self-smoke 29716348297](https://github.com/0disoft/service-catalog-generator/actions/runs/29716348297)
  and [CodeQL 29716348289](https://github.com/0disoft/service-catalog-generator/actions/runs/29716348289).
- Provider-side review record:
  [GitHub issue #5](https://github.com/0disoft/openfeature-local-provider-audit/issues/5).
- Maintainer relationship: `same-maintainer`. This is disclosed ownership, not an
  independent-maintainer claim.

## Released Downstream Consumer

The stable package is also a production runtime dependency of the separately released
[`0disoft/mcp-security-proxy`](https://github.com/0disoft/mcp-security-proxy) CLI.

- Adoption commit:
  [`3814cea2e5539ee0efe2b3f573571fb7a3ea4d21`](https://github.com/0disoft/mcp-security-proxy/commit/3814cea2e5539ee0efe2b3f573571fb7a3ea4d21).
- Released downstream artifact: `@0disoft/mcp-security-proxy-cli@0.2.0-alpha.4`, tagged
  `v0.2.0-alpha.4` at commit `1fbcbe224fa494c059799b3e34b1ee4d80b7cb6d`.
- Package dependency: `@0disoft/openfeature-local-provider@1.0.0`, resolved from the normal npm
  registry and declared as an exact runtime dependency in the released CLI manifest.
- Consumer behavior: a local snapshot hot-reloads `mcp.ops.metrics.enabled` and gates only optional
  operations-metric writes. Invalid replacements keep the last valid value; policy, approvals,
  audit writes, protocol guards, shutdown, and process containment remain outside the flag.
- Release workflow run:
  [29732523891](https://github.com/0disoft/mcp-security-proxy/actions/runs/29732523891),
  completed successfully after publishing and verifying all five downstream packages.
- Independent registry-smoke run:
  [29732878686](https://github.com/0disoft/mcp-security-proxy/actions/runs/29732878686),
  completed successfully against the exact published versions and provenance metadata.
- Final downstream main CI run:
  [29734336343](https://github.com/0disoft/mcp-security-proxy/actions/runs/29734336343),
  completed successfully for the repository check and Linux/Windows process-tree smokes.
- Maintainer relationship: `same-maintainer`. This is a second real released consumer repository,
  not an independent-maintainer claim.

## Evidence Boundary

The package repository's own harness proves exact artifact identity and broad package-surface
compatibility. The SCG result adds actual use in a separate repository with its own lockfile,
build, CLI behavior, tests, and hosted CI. MCP Security Proxy adds an independently released
downstream CLI whose runtime behavior consumes stable `1.0.0` and whose published packages passed
exact-version registry verification. All three repositories are maintained by `0disoft`, so these
results prove repeated cross-repository dogfooding but not organizational independence.

## Stable Promotion Enforcement

`docs/testing/cross-repository-consumer-evidence.json` is the source-owned release-gate record.
It accepts the SCG result and identifies the exact candidate package spec, separate consumer
project and immutable revision, successful consumer CI run, issue URL, normal registry install,
disclosed maintainer relationship, outcome, reviewer, and review timestamp.

`pnpm run stable-release-gate` validates that record. Prereleases and existing `0.x`
releases remain runnable with pending evidence, but stable `1.x` is rejected until a complete
cross-repository result is accepted; changing the patch version cannot bypass the gate. The
accepted same-maintainer result is sufficient because repository separation, normal-registry
installation, immutable revision, hosted CI, and ownership disclosure are all enforced.

## Scheduled Channel Selection

The channel planner tests `latest` on all three platforms and adds `next` only when it
is a newer prerelease. With `latest=1.0.0` and `next=1.0.0-rc.2`, the scheduled matrix
contains three stable jobs. Historical six-job results above predate this optimization.
Manual dispatch can still test `1.0.0-rc.2` or another exact version/channel explicitly.
