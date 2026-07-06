# Pre-Implementation Contract Slices

Status: Accepted
Owner: 0disoft

## Context

This repository is still a design scaffold. Implementation has not started, but future
code will need stable contracts for flag schema, environment overrides, bucketing,
evaluation reasons, audit events, replay fixtures, privacy, release readiness, and test
evidence.

Putting those decisions only in source code would make the first implementation the
accidental source of truth.

## Decision

Before implementation, the repository records separate contract documents for:

- MVP scope cuts.
- Repository strategy and package split policy.
- Flag file schema v1.
- Environment override priority and naming.
- Bucketing v1.
- Evaluation reason taxonomy.
- Audit event v1 and redaction defaults.
- Replay fixture v1.
- Privacy, redaction, and local threat model.
- Release and publishing readiness.
- Contract and replay test plans.

Implementation work must either follow these documents or update them and the relevant
compatibility notes in the same change.

## Consequences

- Future code changes have clearer review blockers.
- Compatibility-sensitive behavior cannot hide inside examples or implementation details.
- Some technology choices remain undecided until an owner records package, runtime, license, and release decisions.

## Review Blockers

- Implementation changes conflict with a contract document without updating it.
- A compatibility-sensitive behavior is defined only in source code or tests.
- Runtime, license, package manager, or publishing decisions are treated as final without owner approval.
