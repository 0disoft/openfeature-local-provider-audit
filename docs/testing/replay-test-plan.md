# Replay Test Plan

Status: Draft
Owner: 0disoft

## Purpose

Replay tests protect deterministic output, especially bucketing behavior and reason
metadata.

## Required Coverage Once Implementation Exists

- Stable bucket outputs for representative targeting keys.
- Boundary percentages.
- Missing targeting key behavior.
- Env override priority over file rollout.
- Error reason and source metadata.
- Redaction-safe fixture data only.

## Review Blockers

- Bucketing implementation lacks replay fixtures.
- Fixture data contains real personal or production data.
- Fixture drift is accepted without semver and migration review.
