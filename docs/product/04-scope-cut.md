# Scope Cut

Status: Draft
Owner: 0disoft

## Purpose

This document keeps the MVP small enough to remain a local OpenFeature provider library
instead of drifting into a feature flag platform.

## In MVP

- JSON flag snapshot loading.
- YAML flag snapshot loading as a post-MVP extension approved by
  docs/adr/0006-yaml-snapshot-loader.md.
- Explicit environment override support.
- Boolean, string, number, and object evaluation.
- Static flag evaluation and default fallback.
- Deterministic percentage bucketing.
- Evaluation reason metadata.
- Redacted JSON Lines audit events.
- Sanitized replay fixtures for compatibility tests.
- Server-side TypeScript and OpenFeature integration examples.

## Out Of MVP

- Hosted dashboard, remote management server, streaming updates, approval workflow, experiment analytics, and segment database.
- HTTP API and managed database.
- File watching, hot reload, browser SDK, multi-language SDKs, and CLI.
- General-purpose targeting rule language, country or plan rules, regex rules, and stored user segments.

## Deferred Extension Rule

Deferred features require an ADR before implementation. The ADR must name the source of
truth, compatibility impact, validation evidence, and whether the feature changes flag
evaluation output for existing consumers.

## Review Blockers

- A deferred feature enters implementation without an ADR.
- A local-provider path starts requiring network, database, or hosted service availability.
- A convenience feature weakens audit redaction, replay determinism, or default fallback behavior.
