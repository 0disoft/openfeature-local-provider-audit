# Read-only chained audit diagnosis

```sh
openfeature-local-provider audit-diagnose ./audit-directory
```

This command inspects a dedicated `createChainedFileAuditSink` directory without
creating directories/manifests/locks, flushing a sink, recovering a suffix, pruning,
renaming or deleting evidence. All file descriptors use read-only access with
no-follow/nonblocking flags where supported. Files and directories retain the
writer's ownership/type checks; parent directories must remain trusted. Existing
`getCheckpoint()` still recovers and may clean storage; it is not this inspector.

The JSON response contains only status, observed counts, lock/manifest presence and
fixed issue codes with optional zero-based segment indexes. It excludes paths,
filenames, chain IDs, checkpoints, raw events and exceptions. Objects in the result
are frozen. Presence/count fields can be null when the corresponding inspection
did not run. Counts describe completed observations, not total unread directory data.

Statuses:

- `valid`: the observed manifest and retained records matched, with no reported artifacts.
- `empty`: an existing directory was empty; nothing was initialized.
- `busy`: a lock was observed before or after inspection. No stale-owner judgment or
  lock takeover occurs; a lock present initially prevents manifest/record reads.
- `changed`: file/directory identity, size or modification stamps changed during
  inspection, or a final consistency probe failed. A definitive verdict is withheld.
- `issues`: fixed issue codes report unreadable/invalid/missing metadata, unsafe
  directory/file access, mismatching segment size/head, uncommitted tip bytes,
  unreferenced segments, temporary/unexpected entries or exhausted limits.

`UNCOMMITTED_TAIL` reports bytes beyond the committed tip size; it does **not** say
they are recoverable, acknowledged, malicious or safe to delete. Other artifacts
also remain untouched. `SEGMENT_UNREADABLE` can include framing/UTF-8/record-size
failures. Busy/changed observations suppress definitive issue codes; their partial
counts are not a corruption diagnosis. Stop writers and preserve a copy before
operator repair. A missing directory returns a diagnostic failure without creating it.

The result always has `consistentSnapshot: false` and
`checkpointAuthenticated: false`. Unlocked observations and filesystem timestamps
cannot establish an atomic snapshot or detect every concurrent/hostile change.
Even a valid manifest is not an independently trusted checkpoint. Use `audit-verify`
on a closed copy with an external authenticated checkpoint for that boundary.
Reads may update access times; original bytes, directory entries and modification
times are not intentionally changed. Read-only diagnosis does not perform evidence
export or automatic repair, and does not support a plain file sink directory.

Limits are inclusive: `--max-bytes` defaults to 256 MiB (maximum 1 GiB),
`--max-record-bytes` to 1 MiB (maximum 16 MiB), `--max-records` to 100,000
(maximum 10,000,000; zero permits only zero records), and `--max-entries` to 512
(maximum 10,000). The manifest has a separate 256-KiB read cap and at most 128
segments. Directory iteration stops after observing the first excess entry and
closes its handle. Segment verification is serial and bounded, retaining one
record at a time. No network I/O, background worker or retry is installed.

Exit codes: 0 for `valid`/`empty`, 1 for `busy`/`changed`/`issues`, 2 for usage errors.
Diagnostic failures are JSON on stdout; usage errors are generic on stderr and
never echo untrusted arguments. Command help is available through `--help`.
