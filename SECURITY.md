# Security Policy

Status: Draft

## Reporting a Vulnerability

Use GitHub private vulnerability reporting when available for this repository.

Do not open public issues for suspected vulnerabilities involving audit redaction,
targeting context exposure, package publishing, or dependency compromise. Public reports
may expose enough detail for misuse before a fix exists.

## Scope

In scope:

- Audit output leaking raw evaluation context.
- Examples or fixtures containing secrets or personal data.
- Package metadata or publishing configuration that could mislead consumers.
- Provider behavior that treats feature flags as authorization.

Out of scope:

- Customer-owned flag files, audit logs, environment variables, and deployment secrets
  that are not part of this repository.

## Defaults

This package should not require credentials for local evaluation. Audit output must be
redacted by default, and examples must use synthetic data only.
