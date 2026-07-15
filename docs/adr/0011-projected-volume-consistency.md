# ADR 0011: Projected-Volume Consistency

Status: Proposed
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
  for semantically unchanged snapshots.

This evidence proves the gap and the reusable reload boundary. It does not yet establish a
portable polling interval or implementation cost.

## Proposed Decision

- Keep native watching as the primary low-latency signal.
- Add an explicit, opt-in consistency poll to `watchFlagSnapshotFile` rather than enabling
  background polling for every existing consumer.
- Poll metadata for the resolved visible path, not Kubernetes-specific `..data` paths. The
  fingerprint must detect target replacement even when file size and modification time are
  unchanged; device and inode identity must be included where the platform exposes them.
- A changed fingerprint enters the same debounce and serialized reload queue as a native
  event. Parsed snapshots that are semantically unchanged remain suppressed.
- A poll tick performs metadata work only. It must not read, parse, or validate the snapshot
  unless the fingerprint changes.
- Poll failures use the existing `onError` boundary and preserve the last valid snapshot.
- `close()` must stop polling, cancel pending debounce work, and prevent a queued poll from
  publishing a snapshot after closure.
- Manual `reload()` remains available and keeps its current callback behavior.
- The public option name, minimum interval, and whether unsupported inode identity requires a
  conservative reload remain `UNDECIDED` until implementation measurements and cross-platform
  fixtures exist.

No public option or runtime behavior is added by this ADR alone.

## Performance Boundary

The future poll must have one timer per watcher and constant metadata work per tick. The
polling interval must be validated as a positive bounded value, but an exact minimum is not
claimed without measurements. Benchmarks must report idle metadata operations and changed-path
reload cost separately; evaluation remains free of file I/O.

## Compatibility

The proposed mode is opt-in, so existing watcher behavior and resource use remain unchanged.
Adding the option later is expected to be a pre-1.0 minor change because it introduces a new
public capability. Changing the default watcher strategy would require a separate compatibility
decision and migration note.

## Validation Gates

- Linux integration coverage performs a real projected-volume symlink swap.
- Unit coverage proves same-size and same-mtime target replacement is detected by identity.
- Native and polling signals for one change produce one semantic callback.
- Invalid and temporarily missing targets report errors without replacing the active snapshot.
- Closing during debounce, metadata polling, and queued reload work produces no later callback.
- Windows and macOS tests prove that opting out preserves their current watch strategy.
- Performance evidence names the selected interval and idle metadata-call budget.

## Rejected Alternatives

- Treat every hidden-file directory event as a snapshot change: noisy unrelated events would
  trigger repeated reads and parsing.
- Watch `..data` directly: this hard-codes one projected-volume layout and still depends on
  native event delivery.
- Poll and parse on every tick: this spends snapshot-size work while nothing has changed.
- Enable polling for all watchers by default: this changes existing resource use before its
  interval and cross-platform cost are measured.

## Review Blockers

- Implementation invents a public option or interval that this ADR still marks `UNDECIDED`.
- A timer reads the full snapshot when metadata is unchanged.
- Poll and native events bypass the existing reload queue or duplicate callbacks.
- Shutdown allows polling or queued reload work to publish after `close()`.
- Documentation claims projected-volume consistency before the implementation gates pass.
