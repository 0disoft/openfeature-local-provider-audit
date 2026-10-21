# Audit waiting and failure policy

The default remains `auditFailurePolicy: "bestEffort"` and
`auditWriteMode: "nonBlocking"`. Writes and redaction failures are observed and
logged without changing evaluation. Existing `"blocking"` waits for completion,
still preserving the result on failure. Blocking without a timeout retains its
existing unlimited wait.

```ts
const sink = createFileAuditSink({ path: auditPath, maxQueueSize: 1_000 });
const provider = createLocalProvider({
  snapshot,
  auditSink: sink,
  auditFailurePolicy: "returnDefault",
  auditTimeoutMs: 250
});
```

`returnDefault` implicitly selects blocking mode when `auditWriteMode` is omitted.
It requires a sink with `writeConfirmed(event): Promise<void>`; explicitly selecting
non-blocking mode, omitting the sink or using an ordinary enqueue-only sink throws
at construction. Confirmation is a separate optional sink capability: it must
resolve only after actual sink writing, must never silently drop an event, and must
reject on write/overflow failure. Custom sinks retain their receiver when invoked.
Sink implementations and their acknowledgment guarantees are trusted caller code.

The file sink supports confirmation and overrides its `dropNewest` policy with
rejection **for that confirmed call only**. Rejections increment `rejectedWrites`;
ordinary `write` retains its configured overflow policy. File confirmation means
append and handle close completed, not fsync, crash durability, remote replication,
or protection against later deletion. `flush` retains its original failure ledger.

On confirmation/redaction failure or timeout, `returnDefault` returns the caller's
default with reason `ERROR`, SDK error `GENERAL` (internal `AUDIT_SINK_ERROR`),
a generic message and no selected variant, rule identity or original flag metadata.
Actual SDK integration follows this behavior. This is **not application-level
mandatory auditing**: the SDK returns a default instead of aborting a business
operation. Applications that require an audit before performing a sensitive action
must inspect details and refuse that action on error; choose safe defaults.

The audit record is the candidate evaluation made before confirmation. A timed-out
write may append later, even though the caller received a default. Do not infer
business execution or the final failure-policy response from this candidate record.
No second recursive audit write is attempted after an audit failure.

`auditTimeoutMs` bounds asynchronous waiting and must be an integer from 1 to
2,147,483,647. It requires a sink and blocking mode. The default for `returnDefault`
is 1,000 ms; best effort has no default timeout. Best-effort blocking can opt into
a timeout while retaining the candidate result. Timers are cleared on every wait
outcome. This does not preempt synchronous code or cancel the underlying write.

Status `timedOutWrites` counts timed-out waits separately. Pending writes stay
pending until the actual promise settles, and later resolution/failure updates
their counters once. A timeout is not a completed or rejected write. A permanently
stalled custom sink remains pending; callers own its resource bounds and lifecycle.
`onClose` still awaits the sink's flush without this evaluation timeout.
