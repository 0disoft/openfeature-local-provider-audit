# ADR 0013: bounded local targeting and offline inspection

Status: Accepted for implementation by the P0/P1 work request on 2026-10-21.
Owner: 0disoft

## Decision

Extend the local provider with an explicitly opted-in schema v2. Preserve schema v1
validation, environment priority, defaults, hashes and bucketing. Schema v1 continues
rejecting v2 fields. Use one validated evaluator for provider, explanation, replay,
and CLI simulation. There is no network or file read in evaluation and no segment DB.

Public declarations expand the snapshot version and reason unions. This can break
exhaustive consumers even when v1 runtime results are unchanged. Stage version 2.0.0
and an explicitly reviewed declaration baseline; do not publish, tag, or push.

The detailed contract is `docs/library/flag-file-schema-v2.md`. New sources of truth
are that contract and the local inspection contract. Existing product/scope/API,
semver, privacy and migration docs must agree before completion.

## Semantics

- First matching rule wins. Missing or wrong-type context does not match a condition.
- Conditions use bounded all/any trees and typed comparisons, including strict SemVer.
  There is no arbitrary JS, regular expression, clock dependency, or network lookup.
- V2 disabledVariant is an explicit emergency selection after flag/type checks, ahead
  of overrides including override errors. It is a selected variant, not caller default.
- Otherwise priority remains explicit JSON override, mapped environment override,
  first targeting rule, top-level percentage rollout, static default.
- A matched rule's rollout uses the existing hash algorithm/seed contract. Unallocated
  buckets select the flag default and do not continue to later rules. Missing targeting
  keys on a selected rollout produce INVALID_CONTEXT and caller default.
- Explanations expose rule IDs/status, selected variant/reason and bucket, never raw
  context or evaluated values. IDs and variant names must be non-sensitive metadata.
- Simulation/comparison emits aggregate counts, no input contexts or individual values.
  Inputs must be bounded local JSON files; no process environment is implicitly used.

## Evidence and recovery

Verify v1 rejection of v2 fields, bounded malformed v2 rejection, priority collisions,
context type/missing fields, SemVer prereleases, rollout continuity, SDK registration,
reload, redacted audit/explanation, replay and packed CLI/ESM/CJS/type consumption.
Benchmark v2 separately from v1. Roll back by deploying v1 snapshots before reverting
the package; older packages reject v2 rather than silently ignoring targeting.

Remote fetching/signatures, scheduled rollout, hash chains/HMAC, hosted control planes,
browser support and other runtimes remain outside this decision.
