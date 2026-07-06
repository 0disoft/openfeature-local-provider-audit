# Quality Attributes

Status: Draft

## Boundary

Quality attributes are part of the product contract because users will put this provider
in tests, local development, and restricted production-like environments.

## Runtime Flow Constraints

- Deterministic: identical snapshot, env, flag key, default value, and targeting key must resolve identically.
- Explainable: every evaluation path must expose a reason suitable for tests and audit review.
- Private by default: audit output must prefer redacted context summaries over raw evaluation context.
- Small: local provider behavior must remain library-sized and not require a service process.

## Quality Attributes

- Maintainability: flag schema, provider API, audit event shape, and replay fixture format must stay documented.
- Security: no secret, token, email, or raw user context field should be emitted unless the caller explicitly opts in.
- Operability: failures must distinguish parse error, missing flag, type mismatch, override parse failure, and bucketing fallback.
- Portability: the MVP should avoid runtime-specific APIs unless they are isolated behind adapters.
