# Signed snapshot storage and restart recovery

Read-only `snapshot-diagnose` observes journal structure, locks, interrupted-writer
files and optional public-key verification without invoking recovery or modifying
storage. An expired authenticated floor remains distinct from activation eligibility;
see `snapshot-diagnosis.md` for bounds, status/exit codes and observation limits.

Status: standalone store alpha.10; integrated durable refresh implemented locally in alpha.11.

`createFileSnapshotStore({ path, verification, maxHistory?, maxBytes?,
createDirectory? })` owns a caller-selected local recovery journal. Verification
uses the same pinned Ed25519 keys, audience and policy as signed delivery.
`commit(bytes)` verifies a fresh artifact against the journal's authenticated head,
then atomically replaces the journal. It never accepts an older sequence, earlier
issuance or another artifact at the same sequence. Failed validation preserves it.

`load({ signal }?)` preserves existing no-argument calls. A refresher passes its
shared read signal; the file implementation checks cancellation before and after
its bounded journal read, without abandoning an opened handle. Custom stores own
cooperative cancellation and cleanup. `load()` returns undefined only for a missing journal. Corrupt/unverifiable heads
fail closed; recovery never silently falls back to older history. The result has
an authenticated `floor`, optional fresh `current`, and authenticated `history`
entries, newest first. Historical verification authenticates signatures, audience,
schema, issuance and lifetime bounds without requiring current age/expiry or the
current minimum sequence. Historical entries are **not** activation decisions.
Unverifiable older entries (for example retired keys) are excluded, never promoted.
Keep the current head key trusted until a new higher-sequence head is committed
under the rotation key; only then retire the previous key.

```ts
const store = createFileSnapshotStore({ path: recoveryPath, verification });
const recovered = await store.load();
const provider = createReloadableLocalProvider({
  snapshot: recovered?.current?.snapshot ?? safeBootstrap,
  ...(recovered?.current ? { provenance: recovered.current.provenance } : {})
});
const refresher = createSnapshotRefresher({
  provider, source, verifier: createSnapshotVerifier(verification), store,
  ...(recovered ? { previous: recovered.floor } : {})
});
```

If `current` exists, initialize a provider with its snapshot/provenance. Otherwise
use an application-owned safe bootstrap snapshot. Always pass the recovered
`floor` as `previous` to a signed refresher; this keeps replay protection even when
the stored artifact expired. No evaluation performs filesystem I/O.

The default journal bound is 16 MiB (1 byte..100 MiB configurable), with at most five
artifacts (1..32 configurable). Oldest history is discarded to fit either bound;
the new head must fit on its own. Capacity selection encodes each examined artifact
once and keeps only the newest contiguous prefix; it never skips a large older entry
to include a smaller one after it. Exact escaped JSON UTF-8 bytes, commas, envelope
and final newline count toward maxBytes. The journal format/order is unchanged.
Input bytes are copied before asynchronous work.
An authorized rollback selects historical snapshot contents and publishes a new
higher sequence with current issuance/expiry using `signFlagSnapshot`. Selecting
an older journal or replaying its token is not an authorized rollback.

## Bounded recovery input buffers

Journal reads reserve the opened file's observed size plus one EOF-probe byte,
fill that same buffer across short reads, and decode only initialized bytes.
A stable file needs one input buffer and no whole-journal `Buffer.concat` copy.
Each filesystem read remains capped at 64 KiB. If the opened file grows after
stat, capacity doubles up to `maxBytes + 1`; the extra byte still detects overflow.
Shrinkage decodes only the bytes actually read. UTF-8 remains strict and journal
shape/signature/replay-floor checks and finally-bound handle cleanup are unchanged.

For observed size S and bytes read N, requested input capacity is O(S + N),
with each requested buffer length never above `maxBytes + 1`. Growth temporarily
holds both old and new buffers. Geometric growth copies O(N) bytes in total;
it does not copy the full prefix on every short read. Allocation depends
on the observed size too: a truncated file can retain its larger initial reserve.
This is an input-buffer bound, not a total heap/RSS limit: decoding, JSON parsing,
signature verification and concurrent callers have separate memory costs.
Small buffers can share a Node allocator pool, whose backing size exceeds the
requested view length; include that pool overhead when measuring memory.
The backing size need not equal `Buffer.poolSize`: Node 26 also reserves alignment
padding. The regression contract is requested capacity plus one reused backing
store for a stable file, not a fixed allocator slab size. See
[Node 26 qualification](../testing/node-26-qualification.md).

A local real-file probe capped read results to 1/7/65536 bytes for the same
423-byte signed recovery journal. Before this change, cumulative requested input
buffer lengths (including EOF reads) were 27,787,264 / 4,063,232 / 131,072 bytes;
afterwards all three requested 424 bytes. Distinct backing stores referenced by
read buffers totaled those same old sizes versus one shared 8,192-byte pool after
the change. These are controlled short-read allocation
measurements, not production short-read frequency, peak RSS or latency claims.

## Storage ownership and crash boundary

The directory and all ancestor paths are trusted local configuration, not request
input. New directories/files use POSIX 0700/0600. Existing permissions and Windows
ACLs remain caller-owned. Journal reads reject symlinks, nonregular files, foreign
POSIX ownership and multiple hard links. A bounded handle read avoids unbounded
allocation and rejects replacement while opening. Both pathname and handle stats
use `bigint` device/inode IDs: distinct 64-bit IDs must not compare equal through
`number` rounding. Link count and POSIX UID checks use the same exact stats.
Observed size is checked against `maxBytes` before conversion to a numeric buffer
length, so allocation stays within the existing byte bound. Atomic rename replaces the
journal itself rather than writing through an existing link.

Commits use an exclusive sibling `.lock` file and fail immediately on contention.
Lock cleanup also compares exact `bigint` identities and preserves foreign marker
replacements, including after a close failure. Identity checks and removal remain
separate operations, not atomic conditional deletion or filesystem fencing.
There is no automatic stale takeover. After a crash, an operator must confirm the
writer stopped before removing an abandoned lock. Temporary sibling files can be
left by process termination; only that interrupted writer's files may be removed
under the same stopped-writer procedure. Loads read an atomic old or new journal.

The temporary file is flushed before rename; the parent directory is flushed on
POSIX. Windows directory flush is unavailable through this API, and power-loss
durability depends on the filesystem/storage. An error after rename can mean the
new journal already committed: retry the identical artifact or load explicitly;
never restore an older journal to handle an ambiguous result.

Trusted local storage retains the replay floor across ordinary restarts. It is not
a hardware monotonic counter: deletion, restoring a whole older valid journal,
compromised local storage or signing keys require an external trusted minimum
sequence/checkpoint. A missing file is a deliberate bootstrap boundary; applications
that require prior state must treat undefined as a startup error.

## Integrated durable refresh

Pass `store` with a signed `verifier` to `createSnapshotRefresher`. Each refresh
loads and merges the authenticated durable floor before fetching, so stale/missing
caller bootstrap metadata cannot bypass the store's continuity. Invalid storage
fails before fetch. Explicit startup recovery still initializes active contents;
refresh does not silently activate stored history.

Before persistence, the provider validates and prepares immutable next state.
`ReloadableLocalProvider.prepareSnapshot?` returns a `SnapshotUpdateTransaction`
with synchronous `commit()` and idempotent, nonthrowing `cancel()`. Preparation
reserves updates:
other direct updates/preparations reject with `PROVIDER_NOT_READY` while evaluations
continue using the old state. Failed validation never calls the store. Custom
providers used with durable refresh must implement this optional reservation contract.
Direct transaction callers must always commit or cancel their reservation.

After a matching store acknowledgment, durable acceptance advances the replay floor;
only then does the transaction atomically activate snapshot/provenance and emit
configuration events. Store failure cancels preparation and preserves active state,
freshness, ETag and source provenance. `persist` counts the failure once without
retaining paths or causes. A later refresh reloads durable state, including any
ambiguous commit that became visible before a storage error.

Durable acceptance cannot be undone by later application callbacks. If a callback
explicitly replaces the just-activated state, refresh rejects without adopting its
ETag/source provenance, but the accepted durable floor stays advanced. If close
occurs before persistence starts, nothing commits. Once a filesystem commit starts,
close cannot retract it: the promise is drained, no closed provider is activated,
and durable acceptance may remain for restart recovery. A shared refresh timeout can reject before persistence settles: the outcome is then
unknown, and the provider reservation remains held until the actual commit ends.
Late matching acceptance advances the replay floor but cannot activate or cache that
delivery. Reconcile by loading durable state after the actual operation settles;
do not overlap or automatically retry writes. Neither a rejected deadline nor a
cancelled caller wait proves persistence settled.
A monotonic budget check after final signature verification also blocks activation
when synchronous verification outlasts the deadline before its timer can run.
Already acknowledged durable acceptance still advances the replay floor; cancellation
releases the prepared provider reservation without rolling back that acceptance.
A cancelled `refresh({ signal })` wait is not a persistence acknowledgment or rollback.
Old active evaluations retain
exact old audit origin until activation; callback evaluations see the new origin.

This is ordered durable acceptance followed by atomic in-process activation,
not a distributed transaction with arbitrary application callbacks or hardware.
Freshness is checked again after acknowledgment; storage delay cannot activate an
expired artifact. Its already accepted floor remains durable even if this final
check fails. A signed 304 is reverified and acknowledged before renewing freshness.
No automatic scheduler, evaluation-time I/O or background worker is added.
The executable GitOps recipe is in `gitops-snapshots.md`; audit integrity tools
remain a separate delivery slice.

## Compound storage failure diagnostics

File-store load/commit sanitize errors only after owned resource cleanup finishes.
A single failure retains its original identity privately. When an operation and
cleanup both fail, trusted diagnostics receive an AggregateError: the primary
cause is first in errors and in cause, followed by the cleanup failure. Multiple
cleanup layers remain nested, preserving journal read/write/fsync/publication,
handle close, temporary deletion and owned-lock release failures and stage messages.
No native error is replaced merely because finally cleanup also failed.

All acquired handles receive one close attempt. A failed close does not stop the
owned temporary/lock cleanup attempt, and close is not automatically retried.
Lock deletion still requires the acquired handle identity to match the current
marker. A foreign replacement or an identity that could not be read is preserved;
operators must confirm the writer stopped before manually recovering such a marker.

Raw causes remain in the private failure registry and reach only the existing
refresher onFailure({ kind: "persist", cause, timedOut }) operator callback. Public
store/refresh errors retain generic messages without raw cause/errors properties;
provider status and candidate activation do not gain private paths or details.
No callback, public option, journal format or retry policy is added. A cleanup error
can follow a successful journal rename, so rejection does not prove rollback. Load
explicitly to reconcile; never automatically retry a durable write or restore an
older journal in response to a diagnostic failure.
