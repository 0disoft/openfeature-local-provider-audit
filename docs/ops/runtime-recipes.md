# Runtime Recipes

Status: Draft

## Scope

These recipes cover consumer-owned Node.js processes. The package does not own process
supervision, container orchestration, log shipping, or remote health endpoints.

## Snapshot Replacement

Write a replacement file in the watched file's directory, close it, and rename it over the
watched path. Keeping the temporary file on the same filesystem preserves the strongest atomic
rename behavior available to the host.

Do not assume every mounted or network filesystem reports native events for the visible flag
filename. Kubernetes projected ConfigMap and Secret volumes can update internal symlinks instead.
When the mount does not emit an event for the watched path, copy the projected content into a
consumer-owned concrete file with an atomic rename, or invoke `watcher.reload()` from a known
configuration-change signal.

Invalid or oversized replacements call `onError` and leave the last valid snapshot active.
Record the error without logging snapshot contents.

## Graceful Shutdown

Close the watcher before waiting for audit writes. This prevents new reload work from starting
while the process drains its local audit queue.

```ts
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    watcher.close();
    await auditSink.flush?.();
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      console.error("Local provider shutdown failed", error);
      process.exitCode = 1;
    });
  });
}
```

The shutdown function is single-flight so receiving both signals does not close or flush the
same resources concurrently. A supervisor must allow enough termination grace for the configured
audit queue and local filesystem.

## Audit Backpressure

Choose overflow behavior from the value of the audit trail rather than from throughput alone.

- Compliance-sensitive local processes: set a finite `maxQueueSize`, use `reject`, consider
  `auditWriteMode: "blocking"`, and treat write failures as an operational alert.
- Best-effort diagnostics: set a finite `maxQueueSize`, use `dropNewest`, keep non-blocking writes,
  and monitor `auditSink.getStats?.().droppedWrites`.
- Short-lived commands: always await `auditSink.flush?.()` before successful exit.

The compatibility default remains an unbounded queue. Production consumers should make an
explicit choice after measuring their maximum evaluation burst and local write latency.

## Multiple Processes

Use `lock: true` only for processes writing the same local audit path. The lock is advisory,
records an owner token so a stale owner cannot remove a replacement owner's lock during release,
and does not establish correctness on network filesystems. Prefer one audit file per process when
a log collector can merge records downstream.

Use a service-owned directory with POSIX mode `0700` and keep the audit file at `0600`.
Do not place a fixed audit filename directly in a shared temporary directory. On Windows,
use an ACL that prevents other local users from replacing any path component.

Configure `lockTimeoutMs` and `staleLockMs` from the process supervisor's crash and restart model.
An aggressive stale timeout can let two live processes write concurrently; an excessive timeout
can delay recovery after a crash.

## Operational Signals

At minimum, retain these local signals without snapshot contents or context values:

- watcher reload error count and last error time;
- age of the last successful snapshot update;
- pending and dropped audit write counts when the sink exposes stats;
- audit file write, rotation, and lock acquisition failures;
- non-zero dropped writes or a provider-close flush failure;
- repeated audit failures even when the sink's retained error-cause sample is capped;
- package version and snapshot hash associated with an incident.

Flag evaluation values are not authorization decisions. A healthy local provider does not prove
that a caller's permission checks are correct.
