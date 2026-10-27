# Release

Status: Draft

## Operational Contract

Release readiness depends on public API docs, compatibility notes, semver review,
package checks, replay fixture evidence, redaction tests, release readiness policy
checks, npm trusted publishing, and GitHub Release artifact publication.

## Implemented Workflow

- GitHub Actions workflow: `.github/workflows/release.yml`.
- Trigger: pushed tags matching `v*`.
- Tag gate: the tag must match `v${packages/local-provider/package.json.version}`.
- Ancestry gate: the tagged commit must already be contained in `origin/main`.
- Official GitHub Actions are pinned to full commit SHAs, with the reviewed tag noted in
  workflow comments.
- Validation: runs the repository `check` command, the Node basic example smoke, and the
  packed package smoke.
- Stable promotion gate: `stable-release-gate` reads the source-owned cross-repository consumer
  evidence record. It allows prereleases and existing `0.x` releases while the record is
  pending, but rejects stable `1.x` unless a reviewed separate-repository result records the
  exact candidate install, immutable revision, successful CI, ownership relationship, and
  required provenance fields. Skipping to a later patch version does not bypass the gate.
- Artifact: the validation job records the tested `.tgz` SHA-256 and transfers that
  candidate, plus the dependency-free registry verifier, to the isolated publish job.
- Publishing: the publish job has npm OIDC permission but no GitHub write permission. If
  the version is absent, it publishes the exact tested candidate with npm trusted
  publishing and provenance. The job rejects npm CLI versions older than 11.5.1 before
  attempting OIDC. Stable versions use npm dist-tag `latest`; prerelease versions use
  `next`.
- Registry reconciliation: whether the version was newly published or already existed,
  the workflow downloads the npm registry tarball and requires its SHA-256 and dist-tag to
  match the tested candidate and selected release channel.
  Both new and already-visible versions use the same bounded read-only verification:
  at most 36 attempts, five seconds between failures, and 180,000 ms total including
  metadata, tarball bodies and waiting. Each complete attempt has a 15,000 ms limit;
  the pre-publish version probe separately has the same 15,000 ms limit. Probe failure
  never means the version is absent. All verifier network operations are GETs.
  HTTP 404/408/425/429/5xx, transport failures, attempt timeouts and stale/missing
  dist-tags retry; numeric or HTTP-date Retry-After can lengthen waits, but cannot
  extend the total budget. Authentication/other permanent HTTP errors, malformed
  metadata and candidate-byte mismatches fail immediately. A stale dist-tag does
  not hide a hash mismatch. Superseded tags are never changed by this verifier.
  Cancellation and monotonic deadline checks prevent late results or new attempts
  after expiry, including when timer dispatch is delayed. Synchronous work cannot
  be preempted; a non-cooperative injected transport may continue its already-started
  read after rejection, but cannot publish or start a later verification request.
  CLI overrides are --attempts (1..120), --delay-ms (0..60,000), --timeout-ms
  (1..300,000) and --attempt-timeout-ms (1..60,000). The default three-minute window
  fits within the existing ten-minute publish job; no new workflow job is added.
  Failure preserves the last available cause and means verification is incomplete,
  not that npm rejected publication. Reconcile with the exact candidate/version/hash
  using the standalone verify command. Do not repeat npm publish or move dist-tags
  to repair an ambiguous publication outcome. This change does not make a failed
  publish command continue automatically or establish any live registry result.
- GitHub Release: a separate job with no npm OIDC permission attaches the registry-downloaded
  bytes. Prerelease package versions create prerelease-marked GitHub Releases, and 1.0
  releases link the migration guide.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: changed public behavior without matching docs and validation.
- Remaining operational risk: npm trusted publisher settings must continue to match
  `0disoft/openfeature-local-provider-audit` and `.github/workflows/release.yml`; GitHub
  Release creation requires `contents: write` on the isolated GitHub Release job. The
  machine-readable evidence record prevents accidental promotion but cannot replace review of
  whether the recorded consumer actually runs in a separate repository at the cited revision.

## Registry Channel Monitoring

The scheduled registry-consumer workflow always tests `latest` on Linux, Windows, and
macOS. It adds `next` only for a valid prerelease newer than `latest`; after stable
promotion, a superseded candidate does not consume three extra runner jobs. Missing or
malformed `next` is inactive. The planner rejects invalid `latest` rather than silently
skipping stable coverage. Manual dispatch accepts an exact version or dist-tag in its
`version` input for investigations, including historical candidates. Resolved versions
are passed as environment data to the existing registry smoke contract.
