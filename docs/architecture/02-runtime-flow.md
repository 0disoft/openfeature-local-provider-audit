# Runtime Flow

Status: Draft

## Boundary

Runtime behavior starts and ends inside the local provider package. The package may read
caller-supplied files and environment variables, but it must not call a remote feature
flag service during the MVP.

## Runtime Flow

1. Load a flag snapshot from the configured local file.
2. Validate flag shape and value type before accepting the snapshot.
3. Apply environment overrides according to documented priority.
4. Receive evaluation requests through the OpenFeature provider interface.
5. Resolve by exact flag value, explicit override, deterministic bucket, or default fallback.
6. Return value, variant if available, reason, and error details when applicable.
7. Emit a redacted audit event that is safe for local logs and replay fixtures.

Snapshot watching remains outside evaluation. Native events and optional metadata polling
schedule serialized reloads; accepted semantic changes atomically replace provider state and
emit deterministic OpenFeature configuration-change keys.

## Quality Attributes

- Maintainability: changes must preserve source-of-truth documents.
- Security: evaluation context values are never logged raw by default.
- Operability: the same snapshot and replay context must produce the same resolution.
- Compatibility: changes to bucketing input, hash algorithm, reason names, or override priority require migration notes.
