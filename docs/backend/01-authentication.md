# Authentication

Status: Draft

## Backend Contract

The MVP owns no authentication system. Applications authenticate their own callers before
they ask OpenFeature to evaluate a flag.

## Required Decisions

- API owner: not applicable.
- Auth model: caller-owned; this package must not inspect credentials.
- Authorization checks: caller-owned.
- Persistence model: local flag files and local audit output only.
- Error response policy: typed library errors and evaluation reasons.

## Merge Blockers

- A credential, token, session, or tenant model is introduced inside the provider.
- Audit output records authentication material or raw user identifiers by default.
- Examples imply this package replaces application access control.
