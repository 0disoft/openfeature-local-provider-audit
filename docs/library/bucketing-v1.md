# Bucketing v1

Status: Implemented alpha
Repository Type: library

## Purpose

Bucketing v1 defines deterministic percentage rollout behavior. This is one of the most
compatibility-sensitive contracts because small algorithm changes can move users between
variants.

## Contract

- Bucketing requires a stable flag key and targeting key.
- The hash algorithm, canonical input, bucket range, seed behavior, and percentage rounding are public compatibility contracts.
- Missing or invalid targeting input returns the caller default with `ERROR` reason and `INVALID_CONTEXT` error code.
- Replay fixtures must cover bucket boundaries and representative targeting keys.

## Bucketing v1 Decisions

- Hash algorithm: SHA-256.
- Canonical input format: `${seed}\n${flagKey}\n${targetingKey}` encoded as UTF-8.
- Bucket source: first 8 bytes of the SHA-256 digest interpreted as unsigned big-endian.
- Bucket range: integer `0..99999`, computed as `digestPrefix % 100000`.
- Percentage precision: three decimal places. `50` means buckets `0..49999`.
- Rollout rules are evaluated cumulatively in array order. If no rollout rule matches,
  evaluation falls back to the flag's `defaultVariant` with `STATIC` reason.
- Seed default: `v1`.
- Seed scope: rollout rules for a single flag must use at most one shared seed. If no rule
  declares a seed, `v1` is used.
- Unicode behavior: no normalization is applied. The exact JavaScript string value is UTF-8
  encoded for hashing.

## Evaluation Priority

1. Explicit JSON override map.
2. Explicit per-flag env variable.
3. Percentage rollout when `targetingKey` is present.
4. File static default variant.
5. Caller-provided OpenFeature default value on missing flag or error paths.

## Review Blockers

- Bucketing output changes without replay fixture updates.
- A hash or canonicalization decision is made only in source code.
- Targeting keys are logged raw in audit events.
