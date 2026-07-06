# @0disoft/openfeature-local-provider

Status: alpha implementation

This package provides a local OpenFeature provider for JSON flag snapshots. The current
implementation supports schema version 1 parsing, static typed evaluation, explicit
environment overrides, deterministic percentage bucketing, pure evaluator replay
fixtures, missing flag defaults, type mismatch error results, and a minimal OpenFeature
provider adapter.

Deferred features include audit JSON Lines, YAML, file watching, CLI, browser support,
HTTP API, and database integration.
