# Persistence Model

Status: Draft

## Backend Contract

The persistence model is local and caller-owned: flag snapshots are read from files,
environment overrides come from process env, and audit events may be written as JSON Lines.

## Required Decisions

- API owner: not applicable.
- Auth model: not applicable.
- Authorization checks: caller-owned.
- Persistence model: no database; local files and optional local audit logs only.
- Error response policy: invalid persistence inputs map to typed errors and reasons.

## Merge Blockers

- A database, queue, hosted storage, or remote config dependency enters MVP scope.
- File format changes lack compatibility and migration notes.
- Audit logs store raw evaluation context by default.
