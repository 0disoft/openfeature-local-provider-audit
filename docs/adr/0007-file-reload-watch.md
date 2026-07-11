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
- Add a reloadable provider with `createReloadableLocalProvider(options)`.
- Add file watching with `watchFlagSnapshotFile(options)`.
- Keep evaluation file-I/O free. Reload and watch happen at explicit load boundaries and
  replace the provider snapshot atomically for subsequent evaluations.
- Support JSON, YAML, and extension-based auto-detection for `.json`, `.yaml`, and `.yml`.
- Check snapshot file size before reading and parsing. The default maximum is 10 MiB,
  configurable through `maxBytes`.
- Use directory `fs.watch` on Linux for atomic replacement events. On macOS, combine
  directory watching for atomic replacement with direct file watching so writes immediately
  after watcher initialization are not dependent on directory-event delivery alone, and rearm
  direct file watching after a rename replaces the watched inode. On Windows, use `fs.watchFile`
  polling for the watched path to avoid Node.js native file-event crashes and path-prefix
  assertion failures seen on Node.js 24 runners.
- Debounce bursts of native events and suppress event-driven callbacks when the parsed snapshot
  is unchanged. Explicit `reload()` calls still invoke `onSnapshot` after successful validation.
- Native watcher and reload failures must be reported through `onError` and must not replace the
  last valid snapshot or escape as an unhandled watcher error.
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
