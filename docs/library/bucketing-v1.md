# Bucketing v1

Status: Draft
Repository Type: library

## Purpose

Bucketing v1 defines deterministic percentage rollout behavior. This is one of the most
compatibility-sensitive contracts because small algorithm changes can move users between
variants.

## Contract

- Bucketing requires a stable flag key and targeting key.
- The hash algorithm, canonical input, bucket range, seed behavior, and percentage rounding are public compatibility contracts once implemented.
- Missing or invalid targeting input must return a documented fallback reason instead of producing unstable output.
- Replay fixtures must cover bucket boundaries and representative targeting keys.

## Decisions Still Needed

- Hash algorithm name and version.
- Canonical input format.
- Bucket range and percentage precision.
- Seed defaulting behavior.
- Unicode and normalization behavior for targeting keys.

## Review Blockers

- Bucketing output changes without replay fixture updates.
- A hash or canonicalization decision is made only in source code.
- Targeting keys are logged raw in audit events.
