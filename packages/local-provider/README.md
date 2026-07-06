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
const provider = createLocalProvider({
  snapshot,
  auditSink: createFileAuditSink({ path: join(tmpdir(), "openfeature-audit.jsonl") })
});
```

Audit events are redacted before they reach the sink. File write failures are reported
through the OpenFeature logger and do not change the evaluated flag value.
