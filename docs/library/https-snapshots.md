# Caller-triggered HTTPS snapshots

The embedded provider never fetches on evaluation. The source and refresher are
separate caller-owned objects; creating either starts no request or scheduler.

```ts
const provider = createReloadableLocalProvider({ snapshot: initialSnapshot });
const source = createHttpsSnapshotSource({
  url: "https://flags.example.test/production.json",
  timeoutMs: 5_000,
  maxBytes: 10 * 1024 * 1024
});
const refresher = createSnapshotRefresher({ provider, source });
await refresher.refresh(); // Explicitly run from the application's refresh lifecycle.
// Evaluations keep using the last applied local snapshot.
refresher.close(); // Aborts an active fetch; does not close the provider.
```

## Source and transport

`SnapshotSource.fetch({ etag?, signal? })` returns either
`{ status: "content", content: Uint8Array, etag? }` or
`{ status: "notModified" }`. Sources own transport and byte limits; they do not
apply provider state or commit validators. Custom sources are trusted caller code
and must honor cancellation. Raw bytes permit later authenticated delivery adapters
to verify exact content before parsing; plain HTTPS does not provide signatures.

`createHttpsSnapshotSource` uses native Node HTTPS GET with standard TLS certificate
and hostname verification. Optional `ca` is a caller-owned PEM trust certificate;
verification cannot be disabled through this API. Absolute HTTPS only, no URL
username/password, fragment or URL longer than 8,192 characters. URLs and trust
certificates are trusted operator configuration, never evaluation context or end-user
input. Presigned URL queries may contain secrets: protect configuration and any
external network instrumentation. Request exceptions, response bodies and URLs are
not attached to package errors or operational status.

Redirects are rejected, including HTTPS redirects. Only 200 content and a solicited
304 are accepted. Content is identity encoded; gzip/other encodings are rejected to
avoid decompression surprises. Response headers are limited to 16 KiB. Valid
quoted strong/weak ETags up to 1,024 characters are retained; invalid response ETags
are discarded, invalid request ETags reject before I/O. A 304 without a conditional
request rejects. Each attempt uses a separate connection and closes rejected or
oversized streams rather than consuming unbounded bodies.

| Option | Default | Allowed |
| --- | --- | --- |
| `maxBytes` | 10 MiB | Integer, 1 to 100 MiB |
| `timeoutMs` | 5,000 | Integer, 1 to 60,000 ms per attempt |
| `totalTimeoutMs` | Derived attempt/backoff envelope | Integer, 1 to 320,000 ms |
| `maxAttempts` | 3 | Integer, 1 to 5 |
| `retryDelayMs` | 100 | Integer, 0 to 5,000 ms |

Declared Content-Length and streamed bytes are checked before accepting the body.
The body reader coalesces fragments into owned blocks of at most 64 KiB. For B
accepted bytes and block size L = min(64 KiB, maxBytes), final concatenation retains
ceil(B / L) blocks, independent of incoming fragment count. For the default 10 MiB
limit this is at most 160 blocks, rather than one buffer per fragment. This bounds
bookkeeping and avoids retaining every upstream buffer/slab; it adds a payload copy
into owned blocks. A partial final block can retain up to L bytes of capacity until
concatenation. Byte-budget checks precede copying; response destruction remains in
the enclosing finally on success, overflow, stream failure and cancellation.
The attempt deadline covers DNS, connect, TLS, headers and body, not synchronous
snapshot parsing. Retries are limited to timeouts, transient socket/DNS failures,
and HTTP 408/429/500/502/503/504. Backoff uses full jitter from zero to the exponentially growing delay, capped at
5,000 ms; server Retry-After is not used. The shared monotonic `totalTimeoutMs`
budget caps reads and backoff; each attempt receives at most the remaining time.
The default budget is the previous maximum envelope (15,300 ms with default
settings). Event-loop scheduling can delay timer delivery, so successful content
and 304 completions are checked against the earlier of the per-attempt and total
monotonic deadlines before acceptance. Exact equality expires. An over-budget
completion is a retryable timeout under the existing attempt/backoff limits;
each retry gets a fresh per-attempt deadline, never a fresh total budget.
Cancellation retains precedence. This prevents late acceptance but cannot preempt
synchronous work or guarantee that control returns at the configured millisecond.
Validation, storage
and activation never run inside the read retry helper. Abort
cancels active I/O or backoff, clears timers/listeners and never retries deliberately
cancelled work. TLS trust/hostname errors, redirects, oversized/encoded content and
other permanent statuses are not retried.

Source transport failures are `LocalProviderError` / `PROVIDER_NOT_READY` with
generic messages, no raw cause. This code describes unavailable new source content;
it does not mean the already initialized provider stopped serving its last good state.

## Application and ETag commit

`createSnapshotRefresher({ provider, source, format?, maxBytes?, timeoutMs?, onFailure? })` captures the
provider/source. Format defaults to JSON; YAML must be explicit. Refresher maxBytes
has the same default/range and independently limits custom-source bodies. UTF-8 is
strictly decoded and parsed through the existing validated JSON/YAML contracts.
The source's claimed media type does not change the parser.

The shared refresh deadline defaults to 30,000 ms, including recovery, fetch and
persistence. `timeoutMs` accepts integers from 1 to 2,147,483,647. It bounds async
waiting; synchronous parsing and a blocked event loop cannot be interrupted.
A monotonic deadline is also checked before starting work, after reads, after
validation/verification and hashing, before persistence, and before durable
activation. A delayed timer cannot authorize the next phase after its budget
expires (`elapsed >= timeoutMs`). Already running synchronous provider callbacks
cannot be preempted or rolled back by this check. Deadline expiry rejects
with generic `PROVIDER_NOT_READY` and signals read cancellation. A custom source or
store must release its own resources; cancellation cannot force arbitrary I/O to stop.
The refresher retains ownership until outstanding actual reads/writes settle, even
when the waiting result has rejected. Repeated calls meanwhile share that rejected
result, preventing overlapping retries or an expanding queue. Use a larger explicit
limit if transport policy requires more than 30 seconds.

Optional `onFailure({ kind, cause, timedOut })` receives original failure causes only
for trusted operator diagnosis. It must redact sensitive endpoints, paths, tokens
and response data before logging. Nothing logs these causes automatically; public
errors have no raw `cause`. Synchronous and asynchronous callback failures are
isolated. A commit failing after timeout can produce a second diagnostic with its
actual cause, without incrementing the refresh failure counter twice.

Overlapping `refresh()` calls share one promise and one operation; they do not
build an unbounded queue. Optional `refresh({ signal })` cancels only that caller's
wait with `PROVIDER_NOT_READY`; it does not cancel the shared refresh or other
waiters, even when it is the last waiter. An already aborted signal starts no work.
Calls without a signal retain shared-promise identity. A resolved result is `{ status: "updated" | "unchanged",
snapshotHash }`. A 200 with unchanged semantic content and a valid 304 both renew
provider freshness without configuration-change events. No snapshot download,
parse or apply failure replaces the previous snapshot or advances its ETag.

For an unsigned not-modified response, the native provider reuses its current
owned immutable state without repeating full capture/validation, override parsing
or per-flag hashes. Provider freshness still advances; signatures and durable
acceptance are never bypassed by this optimization. See `operational-status.md`.

The refresher captures response status and ETag before verification, persistence
or provider callbacks. Reusing or mutating a custom source response afterward cannot
relabel the applied content with another ETag. Custom-source ETags follow the same
quoted strong/weak, 1,024-character policy as built-in transports; malformed ETags
are discarded so the next refresh requests content unconditionally.

The ETag is sent only while the provider hash matches the snapshot to which this
refresher committed it. An external semantic update invalidates conditional reuse.
If the provider changes while a source is being awaited, the refresher rejects the
conflict without overwriting that newer local state; retry explicitly. Coordinate
one refresher per provider. Different independently created refreshers have separate
operation/validator ownership and are not a distributed update lock.
Reentrant configuration-change callbacks can also replace the just-applied snapshot.
The refresher verifies the resulting hash against downloaded content and rejects
that conflict without attaching the downloaded ETag to a different snapshot.
Detection preserves the caller's replacement; it does not undo reentrant updates
or configuration events already delivered.

Fetch errors record one `fetch` refresh failure and expose a generic source error.
Invalid content/UTF-8/oversize records one `validation` failure and returns generic
`SCHEMA_ERROR`; provider-apply validation failures retain the provider's own count.
Concurrent update conflicts record `load`. Status stores only categories and
timestamps. Closed refreshers/providers reject before application. Intentional
close cancellation does not add a failure. Close ends the refresh wait during
source fetch or recovery load even if a custom implementation ignores AbortSignal.
Late results cannot apply and late rejections are observed. Custom implementations
still own their I/O cleanup; their underlying work may continue after close.
Once persistence starts, internal work drains its acknowledgment. If the shared
deadline expires first, the waiting result reports an unknown persistence outcome;
it does not imply rollback. No commit or whole refresh is automatically retried.
Reservations remain held until the actual commit settles; late matching acceptance
advances the replay floor without activating the expired delivery or its ETag.

`refresher.close()` is idempotent and does not flush/close the provider or source.
Callers own scheduling and shutdown; no recurring timer, worker or management
service is installed. ETags remain controller-local. Optional signature verification
and durable recovery are contracted in `signed-snapshots.md` and
`snapshot-recovery.md`; TLS/ETag alone is not a content provenance guarantee.
Durable refresh prepares validated state, persists acceptance and only then
activates. Close after persistence starts cannot retract an accepted journal.

## Verification boundary

Tests generate a real ephemeral TLS certificate/key with OpenSSL `req -addext`,
run a loopback HTTPS server and remove its temporary files. No private test key or
fake credential is committed. OpenSSL is a test prerequisite, not a runtime package
dependency. Tests cover trusted/untrusted TLS, actual conditional responses,
bounded transport/retries/abort, unchanged evaluation and failed apply/cache behavior.
Native transport semantics follow the official
[Node HTTPS API](https://github.com/nodejs/node/blob/v22.x/doc/api/https.md)
and [HTTP request/stream API](https://github.com/nodejs/node/blob/v22.x/doc/api/http.md).
