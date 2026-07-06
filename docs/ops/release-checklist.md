# Release Checklist

Status: Draft
Owner: 0disoft

## Alpha Readiness

- Apache-2.0 license file present.
- Security reporting policy recorded.
- Package name recorded as `@0disoft/openfeature-local-provider`.
- Runtime targets recorded as server-side Node.js 22 LTS and Node.js 24 LTS.
- `@openfeature/server-sdk` recorded as a peer dependency.
- Static JSON flag evaluation implemented.
- Missing flag and type mismatch behavior tested.
- Package exports smoke tested.

## Beta Readiness

- Env overrides implemented and tested.
- Bucketing v1 implemented with replay fixtures.
- Audit redaction implemented and tested.
- SDK examples use only documented exports.

## Stable Readiness

- Flag schema v1, reason taxonomy, audit event v1, bucketing v1, and package exports are treated as compatibility contracts.
- Semver policy covers flag value changes.
- Release workflow avoids long-lived publish tokens unless an ADR accepts that risk.

## Review Blockers

- A release skips compatibility-sensitive tests.
- Public package metadata is inconsistent with docs/library/public-api.md.
- Public package metadata is inconsistent with docs/adr/0004-package-license-runtime-policy.md.
- Security or license policy is missing for a public release.
