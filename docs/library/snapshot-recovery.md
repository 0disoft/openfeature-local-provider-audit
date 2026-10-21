# Signed snapshot storage and restart recovery

Status: standalone store implemented locally in alpha.10; refresh integration pending.

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
  provider, source, verifier: createSnapshotVerifier(verification),
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

This store does not yet automatically persist a refresher's successful application.
Callers must not claim atomic coordination between independent store commits and
provider updates. That integration remains the next delivery slice, followed by
the GitOps recipe and audit log integrity tools.
