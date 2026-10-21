# Maintenance and targeting delivery

Owner: 0disoft
Status: In progress; local changes are not published evidence.

## Product direction

Keep an embedded Node.js OpenFeature provider with deterministic evaluation, minimal
audit disclosure, and caller-owned files. Prioritize bounded conditional targeting,
safe rollout controls, explanations, and offline simulation. Do not add a control
plane, user database, arbitrary expression execution, or experiment analytics.

The competitive review's numerical scores are opinions, not acceptance criteria.
flagd's Node provider also supports in-process evaluation and offline files:
https://flagd.dev/providers/nodejs/. Distinguish this package by the combined privacy,
replay, operational simplicity, and documented failure behavior; daemon-free execution
alone is not unique. Independent adoption remains unverified. Same-maintainer consumer
reports must remain identified as such.

## Existing issue and PR disposition

Checked against GitHub open issues and PRs on 2026-10-21. No remote issue, PR, branch,
tag, release, or npm publication was changed. These are local implementation mappings,
not claims that the GitHub tickets are closed.

| Item | Local implementation | Remaining public evidence |
| --- | --- | --- |
| #10 dependency dashboard | 766bf2b, 17f60e6, 68e73c0, 4fa88d0 | Dashboard refresh after an explicitly authorized push |
| #11 active registry channels | afec929 | Hosted workflow on the changed source |
| #12 release evidence reconciliation | 6256473 | No new publication implied |
| #13 TypeScript 7 declarations | 3b0ee9c | Supported Linux/macOS/Windows CI on the changed source |
| #14 Node 26 canary | 0d7b528 | Scheduled/manual canary result; Node 26 remains unsupported |
| PR #16 Node 26 types | 766bf2b retains Node 24 types to match supported runtimes | Deliberate runtime promotion later |
| PR #17 Vitest advisory | 766bf2b, superseded by 68e73c0 (Vitest 5) | Remote PR reconciliation after push |
| PR #18 YAML 2.9.1 | 766bf2b | Remote PR reconciliation after push |
| PR #19 development updates | 17f60e6 | Remote PR reconciliation after push |

## Delivery slices

1. P0: document the issue disposition and product position; measure evaluation,
   provider audit modes, memory deltas, and local snapshot propagation. Retain the
   existing stalled audit queue benchmark for saturation evidence.
2. P1: accept a targeting ADR and schema/compatibility contract before implementation.
3. P1: validate bounded v2 conditions while preserving v1 input and bucketing.
4. P1: implement first-match rules, conditional rollout, and explicit emergency stop.
5. P1: expose redacted explanations and compatible replay of selected rule identity.
6. P1: add read-only CLI evaluation, aggregate simulation, and before/after comparison.
7. P1: verify packaged consumers, document migration and measured performance, then
   audit this inventory against actual code and results.

Each completed slice is verified and committed separately on the existing local main.
Preserve unrelated changes. No push or hosted run is authorized by this document.

## Completion boundaries

P0/P1 requires actual targeting, rollout control, explanations, simulation and
comparison, compatible v1 behavior, bounded validation, privacy-safe output, and
packaged API/CLI checks. A green existing test suite alone is insufficient.
Remote snapshot fetching, signatures, persistent rollback, telemetry adapters, audit
chains/HMAC, scheduled rollout, and other runtimes remain later work.
