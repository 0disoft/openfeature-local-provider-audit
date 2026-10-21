# Signed snapshot storage and restart recovery

Status: standalone store alpha.10; integrated durable refresh implemented locally in alpha.11.

`createFileSnapshotStore({ path, verification, maxHistory?, maxBytes?,
createDirectory? })` owns a caller-selected local recovery journal. Verification
uses the same pinned Ed25519 keys, audience and policy as signed delivery.
`commit(bytes)` verifies a fresh artifact against the journal's authenticated head,
then atomically replaces the journal. It never accepts an older sequence, earlier
issuance or another artifact at the same sequence. Failed validation preserves it.

`load()` returns undefined only for a missing journal. Corrupt/unverifiable heads
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
the new head must fit on its own. Input bytes are copied before asynchronous work.
An authorized rollback selects historical snapshot contents and publishes a new
higher sequence with current issuance/expiry using `signFlagSnapshot`. Selecting
an older journal or replaying its token is not an authorized rollback.

## Storage ownership and crash boundary

The directory and all ancestor paths are trusted local configuration, not request
input. New directories/files use POSIX 0700/0600. Existing permissions and Windows
ACLs remain caller-owned. Journal reads reject symlinks, nonregular files, foreign
POSIX ownership and multiple hard links. A bounded handle read avoids unbounded
allocation and rejects replacement while opening. Atomic rename replaces the
journal itself rather than writing through an existing link.

Commits use an exclusive sibling `.lock` file and fail immediately on contention.
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
and durable acceptance may remain for restart recovery. Callers must await the
in-flight refresh to know persistence has settled. Old active evaluations retain
exact old audit origin until activation; callback evaluations see the new origin.

This is ordered durable acceptance followed by atomic in-process activation,
not a distributed transaction with arbitrary application callbacks or hardware.
Freshness is checked again after acknowledgment; storage delay cannot activate an
expired artifact. Its already accepted floor remains durable even if this final
check fails. A signed 304 is reverified and acknowledged before renewing freshness.
No automatic scheduler, evaluation-time I/O or background worker is added.
The executable GitOps recipe is in `gitops-snapshots.md`; audit integrity tools
remain a separate delivery slice.
