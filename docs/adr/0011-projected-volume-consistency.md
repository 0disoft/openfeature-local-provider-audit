# ADR 0011: Projected-Volume Consistency

Status: Accepted
Owner: 0disoft

## Purpose

Define a bounded, opt-in consistency strategy for local snapshot paths whose visible
filename does not receive a native event when an orchestrator swaps an internal symlink.

## Context

Linux currently watches the snapshot's parent directory and reloads only when the event
filename matches the visible snapshot filename. Kubernetes-style projected ConfigMap and
Secret volumes instead keep the visible file linked through `..data` and atomically replace
that internal symlink. The visible file resolves to new content, but the directory event can
name `..data` rather than `flags.json`, so the current filter intentionally ignores it.

Recursive watching of implementation-specific volume directories would couple the package
to one orchestrator layout and would still depend on filesystem event delivery. Reloading and
parsing on every timer tick would replace one missed-event problem with unbounded background
I/O.

## Current Evidence

- The Linux projected-volume fixture creates revision directories, a visible file linked
  through `..data`, and an atomic `..data` replacement. Explicit loading follows the new
  target and returns the updated snapshot.
- The deterministic Linux watch-handle test proves that a `rename` event for `..data` is
  filtered while an event for the visible `flags.json` path triggers reload work.
- Existing event-driven reloads already serialize through one queue and suppress callbacks
  when the validated snapshot serialization is unchanged.

The implemented consistency poll reuses that reload boundary. Cross-platform tests establish
the 50 ms minimum interval, metadata-only idle work, serialized reload behavior, and clean
shutdown contract; the remaining filesystem limitation is recorded below.

## Decision

- Keep native watching as the primary low-latency signal.
- Add `consistencyPollIntervalMs` as an explicit, opt-in consistency poll on
  `watchFlagSnapshotFile` rather than enabling background polling for every existing
  consumer.
- Poll metadata for the resolved visible path, not Kubernetes-specific `..data` paths. The
  fingerprint must detect target replacement even when file size and modification time are
  unchanged; device and inode identity must be included where the platform exposes them.
- A changed fingerprint enters the same debounce and serialized reload queue as a native
  event. Parsed snapshots whose validated serialization is unchanged remain suppressed;
  provider-level semantic comparison separately ignores object insertion-order differences.
- A poll tick performs metadata work only. It must not read, parse, or validate the snapshot
  unless the fingerprint changes.
- Poll failures use the existing `onError` boundary and preserve the last valid snapshot.
- `close()` must stop polling, cancel pending debounce work, and prevent a queued poll from
  publishing a snapshot after closure.
- Manual `reload()` remains available and keeps its current callback behavior.
- Require an integer interval of at least 50 ms. This reuses the existing Windows polling
  floor and bounds one watcher's idle metadata checks to at most 20 per second.
- Compare device, inode, modification time, change time, and size. Filesystems that do not
  expose useful identity and preserve every remaining field across a content change remain
  outside the consistency guarantee.

## Performance Boundary

The poll uses Node.js `fs.watchFile`, has one stat watcher per opted-in snapshot watcher, and
performs constant metadata work per tick. The 50 ms floor bounds idle metadata checks to 20 per
second; callers should choose a slower interval when their freshness target permits it. Snapshot
read and parse work occurs only after the stat fingerprint changes. Evaluation remains free of
file I/O.

## Compatibility

The mode is opt-in, so existing watcher behavior and resource use remain unchanged. The option
and configuration-change events are released as the pre-1.0 minor version `0.16.0`. Changing the
default watcher strategy would require a separate compatibility decision and migration note.

## Validation Gates

- Linux integration coverage performs a real projected-volume symlink swap.
- Unit coverage proves same-size and same-mtime target replacement is detected by identity.
- Native and polling signals for one change produce one semantic callback.
- Invalid and temporarily missing targets report errors without replacing the active snapshot.
- Closing during debounce, metadata polling, and queued reload work produces no later callback.
- Windows and macOS tests prove that opting out preserves their current watch strategy.
- Tests verify the selected interval and the 20-checks-per-second maximum idle budget.

## Rejected Alternatives

- Treat every hidden-file directory event as a snapshot change: noisy unrelated events would
  trigger repeated reads and parsing.
- Watch `..data` directly: this hard-codes one projected-volume layout and still depends on
  native event delivery.
- Poll and parse on every tick: this spends snapshot-size work while nothing has changed.
- Enable polling for all watchers by default: this changes existing resource use before its
  interval and cross-platform cost are measured.

## Review Blockers

- Polling activates without an explicit `consistencyPollIntervalMs`.
- A timer reads the full snapshot when metadata is unchanged.
- Poll and native events bypass the existing reload queue or duplicate callbacks.
- Shutdown allows polling or queued reload work to publish after `close()`.
- Documentation claims projected-volume consistency before the implementation gates pass.
