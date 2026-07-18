# Security Policy

Status: Draft

## Supported Versions

Security fixes are provided for the latest published minor release. Earlier `0.x`
minor releases are unsupported once a newer minor release is available. Prereleases
receive best-effort fixes until they are superseded by a newer prerelease or stable
release.

## Reporting a Vulnerability

Report vulnerabilities through the repository's
[private security advisory form](https://github.com/0disoft/openfeature-local-provider-audit/security/advisories/new).

The maintainer aims to acknowledge a complete report within three business days. While
the report remains open, the maintainer will provide a status update at least every seven
calendar days until a fix, mitigation, or closure decision is available. Disclosure timing
will be coordinated through the private advisory.

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
