# Provider operational status

`staleAfterMs` remains observational. Independent opt-in
`snapshotExpiryPolicy: "returnDefault"` gates active signed expiry during resolution,
without incrementing refresh failures or adding timers/status transitions. Captured
provenance remains visible; see `active-snapshot-expiry.md` for the full contract.

The low-level provider factories return an OpenFeature-compatible provider with
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

Automatic notifications still reopen and read the file with the existing regular-file,
byte-limit and encoding checks. A private SHA-256 fingerprint of decoded UTF-16 code
units lets identical accepted input reuse the current snapshot before parsing,
validation, freezing and serialization. This avoids O(N) snapshot-node processing
and allocations per repeated event, retaining O(B) read/hash work for B input code
units and N snapshot nodes. Total work remains linear for ordinary JSON; file I/O remains.
Only one 64-character fingerprint is retained per watcher, without retaining a
second raw input string. Explicit `reload()` always parses and forwards the result.
Different formatting still goes through parsing and the existing serialized-snapshot
comparison; its fingerprint is accepted after successful validation. Parse failures
and rejected callbacks never replace the accepted fingerprint or last-good snapshot,
so a later notification retries the same failed input. UTF-16 hashing distinguishes
lone surrogate code units that UTF-8 hashing would replace with the same character.

Status is a fresh frozen snapshot, including nested audit counters, with no context,
flag values, paths, raw exceptions, environment overrides or user identifiers.
`snapshotHash` identifies the active content, not authentication or confidentiality.
All timestamps are epoch milliseconds from the wall clock. Staleness instead uses
monotonic elapsed time since the last successful provider refresh, so forward or
backward wall-clock adjustments neither expire fresh content early nor defer stale
status. A successful unchanged refresh also restarts this elapsed interval; a failed
refresh does not. This is an operational age indication, not a security expiry guarantee.

The initial validated snapshot counts as one successful refresh. Every successful
`updateSnapshot` counts, including identical content, updates
`lastSuccessfulRefreshAt`, and resets `consecutiveRefreshFailures`. Only a content
change updates `lastChangedAt` or emits a configuration-change event. Invalid input
counts as `validation`, is rethrown and leaves the snapshot active. External failure
kinds are `load | fetch | validation | signature | persist`; reject other kinds.
The last failure remains visible after recovery; the consecutive counter resets.

When an update passes the exact snapshot currently returned by `getSnapshot()`,
the provider reuses its owned, deeply frozen content and derived override/hash
state. For N snapshot data nodes and F flags, this skips O(N) copying/validation
and F + 1 SHA-256 computations (plus any override hash) per unchanged update.
The identity check and fixed-size state copy use O(1) time/extra space with respect
to N/F; no historical-snapshot cache is added. Provenance is still captured and
checked against the current hash, unsigned updates clear it, refresh counters/age
still advance, and prepare/commit/cancel reservations retain their normal lifecycle.
Equal-content objects, caller-frozen copies and previously active snapshots are
validated normally. This also covers unsigned refresher `notModified` responses;
signed delivery still performs its verifier/freshness/continuity checks.

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
`getStats()` remains synchronous. If a custom sink mistakenly returns a Promise-like
value, its counters are omitted and its rejection is observed without waiting.
Neither rejection nor a never-settling result delays status, evaluation or shutdown;
asynchronous counters are not adopted later. Normal synchronous counters require
no extra Promise allocation. This does not cancel I/O started by a custom diagnostic.
Audit event creation errors count as failures too. No counter resets or per-user
history are retained. Sink flush errors retain their existing propagation behavior
and are not write failures. Counters are JavaScript numbers, not durable accounting.

Alpha.5 adds `timedOutWrites`, counting evaluation waits whose configured deadline
expired, independently of write settlement. See `audit-failure-policy.md`.

Signed snapshots expose optional frozen `provenance` with the exact artifact hash,
sequence, public key ID, audience and lifetime. It is captured with the active
snapshot and cleared by unsigned updates even when contents do not change. It
describes accepted origin, not current signature freshness; see `signed-snapshots.md`.


For an owned file integration use `createWatchedLocalProvider` (`watched-provider.md`).
It connects load/parse failure reporting and avoids double-counting application
rejections, including coalesced automatic/manual reload errors. Its SDK-linked close
releases the watcher before native provider shutdown. This opt-in composition does
not change automatic unchanged suppression or the freshness definition above.
