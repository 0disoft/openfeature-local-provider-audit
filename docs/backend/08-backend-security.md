# Backend Security

Status: Draft

## Backend Contract

Security focuses on local artifact handling and audit redaction. The provider must not
become a credential store or authorization layer.

## Required Decisions

- API owner: not applicable.
- Auth model: caller-owned.
- Authorization checks: caller-owned.
- Persistence model: local files and audit logs only.
- Error response policy: security-sensitive errors must avoid leaking raw context.

## Merge Blockers

- Secrets, tokens, emails, or raw user context are logged by default.
- Flag evaluation is documented as a security authorization decision.
- A remote dependency is introduced without threat-model and ADR review.
