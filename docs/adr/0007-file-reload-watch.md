# File Reload and Watch

Status: Accepted
Owner: 0disoft

## Context

The package started with explicit in-memory snapshots so evaluation remained deterministic
and did not perform file I/O on the hot path. Some consumers need local development and
test processes to pick up changed flag files without recreating the OpenFeature client.
File watch/reload was deferred until the snapshot, replay, audit, and default-return
contracts were covered by tests.

## Decision

- Add explicit file loading with `loadFlagSnapshotFile(path, options)`.
- Copy each load's file-URL path to a string and capture format/encoding/byte limit
  before the first await. Caller mutation of a URL/options object cannot redirect
  that load or switch its parser. String paths retain native filesystem resolution,
  including symlink/parent semantics; callers must keep the working directory stable
  during relative-path loads. Normal atomic file replacement remains supported.
- Add a reloadable provider with `createReloadableLocalProvider(options)`.
- Add file watching with `watchFlagSnapshotFile(options)`.
- Keep evaluation file-I/O free. Reload and watch happen at explicit load boundaries and
  replace the provider snapshot atomically for subsequent evaluations.
- Support JSON, YAML, and extension-based auto-detection for `.json`, `.yaml`, and `.yml`.
- Open the snapshot once, check that handle's size, and read it through a bounded loop
  before parsing. The default maximum is 10 MiB, configurable through `maxBytes`.
  The bounded read also rejects a file that grows past the limit after the initial size
  check.
- Reject non-regular snapshot targets before open, use nonblocking read-only open
  where available, and verify the opened handle is still a regular file before
  reading. A FIFO/device/directory cannot stall a load or the shared watcher queue.
  Regular-file symlink targets remain supported, including projected-volume links.
- Use directory `fs.watch` on Linux for atomic replacement events. On macOS, combine
  directory watching for atomic replacement with direct file watching so writes immediately
  after watcher initialization are not dependent on directory-event delivery alone, and rearm
  direct file watching after a rename replaces the watched inode. On Windows, use `fs.watchFile`
  polling for the watched path to avoid Node.js native file-event crashes and path-prefix
  assertion failures seen on Node.js 24 runners.
- Before each macOS direct-file watcher registration (initial and rearm), synchronously
  stat the target and require a regular file. This avoids registering a FIFO before
  the async loader can reject it. Symlinks to regular files remain valid. Initial
  rejection closes the directory watcher; a failed rearm preserves the previous
  handle and reports the error. This path check is not atomic against concurrent
  replacement; watch paths must remain on trusted storage.
- ADR 0011 adds optional metadata consistency polling for visible paths whose backing
  symlink changes without a visible-filename event. Native watching remains primary.
- Debounce bursts of native events and suppress event-driven callbacks when the parsed snapshot
  is unchanged. Explicit `reload()` calls still invoke `onSnapshot` after successful validation.
- Validate `debounceMs` as an integer in 0..2,147,483,647 before acquiring watcher
  resources or loading the initial file. Keep 50 ms as the omitted default and accept
  zero; reject invalid delays rather than allowing Node to clamp overflow to 1 ms.
- Capture the resolved path, read settings and callbacks before startup awaits.
  Later option/URL changes cannot redirect reloads away from the watched target.
  A URL returned through `watcher.path` is a detached copy of the original URL value.
- Closing attempts every owned native/polling cleanup even if an earlier cleanup
  throws. Ownership is retired before cleanup, so repeated close does not retry
  ambiguous releases. Multiple failures use AggregateError in attempted order, with
  the first as cause; single failures retain their identity. Setup/initial delivery
  failure remains first when cleanup also fails. A polling setup failure closes
  native handles once, including both macOS handles. Cleanup attempts do not guarantee
  that an OS resource whose close failed was released.
- Native watcher and reload failures must be reported through `onError` and must not replace the
  last valid snapshot or escape as an unhandled watcher error.
- Calling `reload()` from that watcher's active `onSnapshot` callback, including after
  an await, rejects with `PROVIDER_NOT_READY` instead of waiting on its own reload queue.
  Reloads from unrelated callers still queue normally. Work scheduled by a callback
  may reload after that callback has finished; `onError` recovery reloads remain supported.
- Do not add hot remote configuration, HTTP APIs, hosted control planes, CLI, browser,
  Bun, Deno, or multi-language SDK support as part of this decision.

## Compatibility Impact

- Existing `createLocalProvider` behavior remains snapshot-immutable.
- Reloadable providers are opt-in through a new public export.
- Updating a reloadable provider changes future evaluations only; in-flight evaluations
  use the snapshot captured at evaluation start.
- Audit events must use the same snapshot that produced the evaluation result.

## Validation

- Unit tests must cover JSON and YAML file loading, reloadable provider updates, manual
  watcher reload, event-driven watcher reload, and invalid reload error handling.
- Existing replay and provider tests must continue to pass.
- Release readiness must stay green before publishing.

## Review Blockers

- Evaluation reads from disk on each flag resolution.
- A failed reload clears or corrupts the last valid snapshot.
- Snapshot files are parsed before the configured size limit is checked.
- Windows watcher behavior depends on unstable native `fs.watch` directory events.
- macOS direct-write behavior depends only on directory events instead of a direct file watcher.
- A macOS atomic replacement leaves direct file watching attached to the replaced inode.
- A native watcher error can escape instead of being reported through `onError`.
- Watch behavior introduces a network, database, hosted service, or platform assumption.
- Audit events hash a different snapshot from the one used for evaluation.
