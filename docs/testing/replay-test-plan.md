# Replay Test Plan

Status: Draft
Owner: 0disoft

## Purpose

Replay tests protect deterministic output, especially bucketing behavior and reason
metadata.

## Required Replay Coverage

- Stable bucket outputs for representative targeting keys.
- Equivalent JSON and YAML snapshots must produce the same replayed output.
- Boundary percentages.
- Missing targeting key behavior.
- Env override priority over file rollout.
- Error reason and source metadata.
- Redaction-safe fixture data only.

## Implemented Fixtures

- `checkout.rollout` with seed `checkout-rollout-v1`.
- `user-alpha` maps to bucket `29586` and variant `on` at 50%.
- `user-beta` maps to bucket `51164` and falls back to the static default at 50%.
- Missing targeting key returns `INVALID_CONTEXT`.
- Env override input wins before rollout evaluation.

## Implemented Harness

- `replayEvaluationFixture` replays one fixture through the pure evaluator.
- The harness compares value, variant, bucket, reason, source, and error code.
- Mismatches are returned as structured field differences.

## Review Blockers

- Bucketing implementation lacks replay fixtures.
- Fixture data contains real personal or production data.
- Fixture drift is accepted without semver and migration review.
