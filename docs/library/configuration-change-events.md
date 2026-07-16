# Configuration Change Events

Status: Accepted
Owner: 0disoft

## Contract

`createReloadableLocalProvider()` exposes the OpenFeature provider event emitter inherited
from `Provider`. A successful `updateSnapshot()` emits
`PROVIDER_CONFIGURATION_CHANGED` after the new validated snapshot becomes active.

The event payload contains `flagsChanged`, sorted by JavaScript code-unit order:

- added flag keys;
- removed flag keys;
- flag keys whose validated definitions changed.

A snapshot-metadata-only update emits `flagsChanged: []`. A semantically unchanged snapshot
does not emit an event, even when object key insertion order differs. Invalid snapshots are
rejected before state replacement and do not emit an event.

The initial snapshot does not emit a configuration-change event. Event handlers are removed
when the provider closes, and updates after close do not emit events. Event handler failures
are isolated by the OpenFeature SDK event emitter and do not roll back an already committed
snapshot.

## Watcher Integration

`watchFlagSnapshotFile()` remains separate from provider ownership. Consumers connect the
boundaries by passing a reloadable provider's `updateSnapshot()` from `onSnapshot`. Native
events and optional consistency polling share the watcher's serialized reload queue;
semantically duplicate snapshots therefore produce one provider update and one configuration
event.

## Compatibility

Configuration-change event support is additive in `0.16.0`. Consumers must treat
`flagsChanged` as a complete list for that event, including an empty list for a
snapshot-metadata-only update. Key ordering is deterministic and compatibility-sensitive.

## Review Blockers

- An event fires before the new snapshot is active.
- An invalid or semantically unchanged snapshot emits an event.
- Added or removed flags are omitted from `flagsChanged`.
- Changed keys depend on object insertion order or locale sorting.
- Watch and polling duplicates produce duplicate semantic events.
- Provider close leaves event handlers active.
