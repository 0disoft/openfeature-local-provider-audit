# Contract Source of Truth

Status: Draft
Owner: 0disoft

## Purpose

Define which documents own product, library, SDK, and compatibility decisions so future
implementation work does not invent behavior from examples or generated scaffold files.

## Source of Truth

- Product decision: source-of-truth documents are explicit and layered.
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: `docs/product/02-spec.md` owns product scope; `docs/library/public-api.md` owns package API; `docs/sdk/public-api.md` owns examples and SDK guidance.
- Data ownership: product docs own local artifact boundaries; implementation docs must not move audit data or flag config to a remote service by implication.
- Failure and recovery behavior: validation reports must name skipped checks and any intentional divergence from `.ssealed/manifest.json` generated checksums.
- Validation needed before merge: VALIDATION.md

## Review Blockers

- A source file, example, or generated scaffold becomes the only place where public behavior is defined.
- A compatibility-sensitive behavior changes without product, library, and SDK docs staying aligned.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
