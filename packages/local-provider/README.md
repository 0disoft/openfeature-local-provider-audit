# @0disoft/openfeature-local-provider

Status: alpha implementation

This package provides a local OpenFeature provider for JSON flag snapshots. The current
implementation supports schema version 1 parsing, static typed evaluation, explicit
environment overrides, deterministic percentage bucketing, pure evaluator replay
fixtures, redacted audit event generation, optional file audit sinks, missing flag
defaults, type mismatch error results, and a minimal OpenFeature provider adapter.

Deferred features include audit rotation, YAML, file watching, CLI, browser support, HTTP
API, and database integration.

## File Audit Sink

```ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileAuditSink,
  createLocalProvider,
  parseJsonFlagSnapshot
} from "@0disoft/openfeature-local-provider";

const snapshot = parseJsonFlagSnapshot(snapshotJson);
const auditSink = createFileAuditSink({
  path: join(tmpdir(), "openfeature-audit.jsonl"),
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  lock: true
});
const provider = createLocalProvider({
  snapshot,
  auditSink
});

await auditSink.flush?.();
```

Audit events are redacted before they reach the sink. Provider audit writes are
non-blocking by default, and file write failures are reported through the OpenFeature
logger without changing the evaluated flag value.

Use `auditSink.flush?.()` before process exit when a short-lived script must wait for
pending non-blocking audit writes. Use `auditWriteMode: "blocking"` when each
evaluation promise must wait for its audit write.

Set `maxBytes` to rotate the active audit file by size. `maxFiles` controls how many
rotated files are retained as `.1`, `.2`, and so on.

Set `lock: true` when multiple local processes may write the same audit file. The lock is
advisory and uses a sibling `.lock` file. `lockTimeoutMs` controls acquisition timeout,
and `staleLockMs` can remove stale lock files left by crashed processes.
