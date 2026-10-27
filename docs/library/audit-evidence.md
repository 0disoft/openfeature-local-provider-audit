# Consistent local audit evidence export

`exportChainedAuditEvidence(options)` captures one committed retained interval from
an existing chained file sink. It is a Node-only root export. It does not initialize,
recover, truncate or prune source storage. Unlike `audit-diagnose`, it temporarily
takes the same mandatory owner lock and process queue used by writers. Source files
are opened read-only; the temporary lock changes directory metadata/access times.
Parents and storage must be trusted, and all writers must honor that lock.

```ts
import { exportChainedAuditEvidence } from "@0disoft/openfeature-local-provider";

// Flush the application's sink first if all of its queued events are required.
await auditSink.flush();
const evidence = await exportChainedAuditEvidence({
  directory: "./audit",
  destination: "./exports/incident-unique", // parent exists; final directory must not
  maxBytes: 256 * 1024 * 1024,
  maxRecordBytes: 1024 * 1024,
  maxRecords: 100_000,
  lockTimeoutMs: 5_000,
  signal: shutdownSignal
});
// Only after success, deliver evidence.files and evidence.json using caller-owned I/O.
```

Flush is not a global drain: writes not committed when the exporter acquires its
lock may belong to the next interval. The result covers retained history, not
already pruned records, business execution, or delivery acknowledgments.

## Capture and completion

Under the writer lock, export copies exact `manifest.json` and retained
`segment-N.jsonl` bytes in order to a newly created private directory. It checks
source identity/size/timestamps around each copy and manifest identity again at
the end. It rejects unreferenced files, orphan segments, partial/uncommitted tips,
missing files and detected changes rather than invoking recovery. A malformed
manifest or exceeded declared byte/record budget fails before destination creation.
Existing destinations, including empty directories, are rejected. Canonical parent
resolution rejects source/destination overlap, including symlink/junction aliases.

After releasing the capture lock, the exporter streams and cryptographically checks
the copied records, including every segment's head. It writes matching `start.json`
and `head.json`, then atomically publishes `evidence.json` last. The frozen result
and completion file contain schemaVersion 1, start/head, record count, sourceBytes,
and an ordered file inventory with name, byte count and SHA-256. The inventory
includes both checkpoint files and excludes the completion file itself.

Failures preserve source evidence and may leave an incomplete destination; there
is no automatic cleanup or retry. Do not treat an incomplete copy as an accepted
bundle or reuse its directory. A final metadata/directory sync failure can report
failure after a completion file becomes visible: inspect the copy rather than
assuming acknowledgment. Durability follows the underlying filesystem, including
the existing platform-specific directory-sync limitations.

## Bounds and cancellation

`maxBytes` defaults to 256 MiB (range 1 byte..1 GiB) and counts copied source bytes,
including the manifest, not generated checkpoints/completion metadata. Manifests
retain the existing 256 KiB cap and 128-segment limit. Directory enumeration stops
on any unexpected entry and permits at most 130 expected entries, including the
exporter's lock. Generated checkpoints are individually capped at 16 KiB and the
completion inventory is bounded by the segment limit.

`maxRecordBytes` defaults to 1 MiB (range 1 byte..16 MiB); `maxRecords` defaults to
100,000 (range 0..10,000,000). Zero permits an empty committed interval. Declared
record count is checked before copying and actual count during verification.
Source copying is sequential, using at most one source/destination pair and a
64 KiB buffer. Verification retains a bounded record, not the entire history.
Copying, hashing, fsync and reading the destination still add O(total bytes) I/O
and hold writers during the copy; do not use frequent exports as a request-path
operation. CPU verification and caller-owned delivery do not hold the capture lock.

`AbortSignal` is checked before admission, after queue waiting, at copy chunks and
verification records, and before completion publication. In-flight filesystem calls,
queue waiting, lock acquisition and synchronous cryptographic work are not
preemptible. Lock waiting uses the existing `lockTimeoutMs` policy (default 5,000 ms;
zero allows one immediate attempt); cancellation can therefore wait for admission
or that acquisition timeout. All opened handles and the owned lock are released
on failure/cancellation. Publication already in progress may finish successfully.

Storage failures reject with generic `AUDIT_SINK_ERROR`; cancellation propagates
the caller's original signal reason. Optional `onError` receives raw operator-only
causes after cleanup, including compound cleanup failures. It preserves the options
receiver, is not awaited and cannot replace the result by throwing/rejecting.

## Trust and recovery boundary

`checkpointAuthenticated` is always false. Checksums and adjacent checkpoints
detect accidental corruption relative to the captured manifest; they do not
authenticate an attacker-replaced history plus inventory. Keep independently
trusted checkpoints outside the source writable boundary and authenticate delivery
separately. Bundles contain original audit data, including explicitly opted-in
identifiers/context keys; treat them as sensitive operator artifacts.

This helper is not a remote uploader, archive compressor or restore command. Extra
checkpoint/completion files make an export unsuitable as a direct active sink
directory. Recover into a separately reviewed new sink using its existing checkpoint
contract. Snapshot-recovery journals remain a different format and are not exported.
