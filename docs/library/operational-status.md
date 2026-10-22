# Provider operational status

Both provider factories return an OpenFeature-compatible provider with
`getStatus(): ProviderStatus` and `reportRefreshFailure(kind)`. Reloadable providers
also retain `getSnapshot()` and `updateSnapshot(snapshot)`.

```ts
const provider = createReloadableLocalProvider({
  snapshot: await loadFlagSnapshotFile(path),
  staleAfterMs: 60_000
});
const watcher = await watchFlagSnapshotFile({
  path,
  consistencyPollIntervalMs: 10_000,
  onSnapshot(snapshot) {
    try { provider.updateSnapshot(snapshot); }
    catch { /* Provider already counted this validation failure. */ }
  },
  onError() {
    provider.reportRefreshFailure("load");
  }
});
const status = provider.getStatus();
// watcher.close() remains the caller's responsibility.
```

The watcher can forward a rejected `onSnapshot` callback to `onError`. To avoid
double-counting, catch validation errors inside `onSnapshot` after the provider has
recorded them; reserve `onError` reporting for load/parse failures. External reporting
is explicit: existing watchers and loaders do not acquire global provider ownership.
Automatic watcher polling suppresses unchanged snapshots, so its successful reads
do not renew provider freshness. Call `watcher.reload()` explicitly to forward a
successful unchanged read when a caller needs periodic confirmation. The age refers
to the last provider validation, not the watcher's liveness or the file's mtime.

Status is a fresh frozen snapshot, including nested audit counters, with no context,
flag values, paths, raw exceptions, environment overrides or user identifiers.
`snapshotHash` identifies the active content, not authentication or confidentiality.
All timestamps are epoch milliseconds from the wall clock. Clock rollback can defer
staleness; this is an operational age indication, not a security expiry guarantee.

The initial validated snapshot counts as one successful refresh. Every successful
`updateSnapshot` counts, including identical content, updates
`lastSuccessfulRefreshAt`, and resets `consecutiveRefreshFailures`. Only a content
change updates `lastChangedAt` or emits a configuration-change event. Invalid input
counts as `validation`, is rethrown and leaves the snapshot active. External failure
kinds are `load | fetch | validation | signature | persist`; reject other kinds.
The last failure remains visible after recovery; the consecutive counter resets.

`staleAfterMs` must be a positive safe integer. Staleness is computed at read time,
including exactly the threshold, and is false when omitted. Staleness does not change
evaluation behavior, start timers, or emit OpenFeature lifecycle events.
`closed` indicates that `onClose` was called, including when flushing fails.

Audit counters belong to this provider: attempted, pending, resolved and failed
`write` calls. A resolved call is an acknowledgment, **not proof of persistence**:
a `dropNewest` sink can resolve after dropping an event. Optional copied `sinkStats`
exposes pending/dropped/rejected writes and queue limit for the whole sink, which
can be shared with other providers. Optional `pendingBytes` / `maxQueueBytes`
report queued event UTF-8 JSON Lines payload bytes and their budget (not total heap).
Old custom sinks may omit both fields. Missing, invalid or throwing diagnostics are omitted.
Audit event creation errors count as failures too. No counter resets or per-user
history are retained. Sink flush errors retain their existing propagation behavior
and are not write failures. Counters are JavaScript numbers, not durable accounting.

Alpha.5 adds `timedOutWrites`, counting evaluation waits whose configured deadline
expired, independently of write settlement. See `audit-failure-policy.md`.

Signed snapshots expose optional frozen `provenance` with the exact artifact hash,
sequence, public key ID, audience and lifetime. It is captured with the active
snapshot and cleared by unsigned updates even when contents do not change. It
describes accepted origin, not current signature freshness; see `signed-snapshots.md`.
