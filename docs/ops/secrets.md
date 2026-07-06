# Secrets

Status: Draft

## Operational Contract

The package should not require secrets. Env overrides are configuration values and must
not encourage users to put tokens, passwords, emails, or raw identifiers into audit logs.

## Owners

- Primary owner: 0disoft
- Backup owner: repository maintainer
- Escalation path: GitHub issue or release-blocking maintainer review

## Validation

- Required validation names: VALIDATION.md
- Release blocker status: docs or examples introduce fake credentials, secret names, or raw personal data.
- Remaining operational risk: callers remain responsible for secret scanning their own flag files and logs.
