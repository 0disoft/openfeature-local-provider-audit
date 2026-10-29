# Managed signed snapshot provider

Status: included in 2.0; Node package root only.

`createManagedLocalProvider` is the Node package-root composition for signed HTTPS,
S3/R2 or custom `SnapshotSource` delivery. It connects verification, authenticated
file recovery, the transactional provider and the bounded refresher. Existing
low-level APIs remain available. It does not register a global OpenFeature provider,
create a server, own source credentials/clients, or publish configuration.

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createHttpsSnapshotSource, createManagedLocalProvider }
  from "@0disoft/openfeature-local-provider";

// configurationUrl, recoveryPath, verification and safeBootstrap are real
// application-owned inputs; verification pins public keys and audience.
const runtime = await createManagedLocalProvider({
  source: createHttpsSnapshotSource({ url: configurationUrl }),
  verification,
  recovery: { path: recoveryPath, createDirectory: true },
  bootstrap: safeBootstrap,
  // Set true only for an authorized first deployment, not every restart.
  allowFirstStart,
  refreshIntervalMs: 30_000,
  refresh: { onFailure: reportRefreshFailure }
});
await OpenFeature.setProviderAndWait(runtime.provider);
// Optional first refresh: await it when network confirmation is required.
await runtime.refresh();
runtime.start(); // explicit, immediate refresh; repeated start is a no-op
// Stop application request intake before shutdown.
await runtime.close();
```

Use `createS3SnapshotSource` instead of the HTTPS factory for S3/R2. Its client and
credential lifecycle remain caller-owned. Source objects are not closed by the
helper. For unsigned local JSON/YAML use `createWatchedLocalProvider`
(`watched-provider.md`); file watching is not silently converted to signed delivery. See `gitops-snapshots.md` for publishing,
rollback and the executable loopback HTTPS/restart recipe.

## Startup and trust

Construction validates bootstrap/options, loads authenticated recovery and returns
without contacting the source or starting a poll timer. Missing recovery rejects
unless `allowFirstStart: true`. Corrupt/unreadable recovery always rejects. Expired
history can leave no current snapshot: bootstrap is then used while the persisted
sequence floor is retained, preventing rollback on subsequent refresh. Missing
recovery is not evidence of a first deployment; applications need an external floor
or an explicit operator decision after data loss.

Startup recovery waiting uses `refresh.timeoutMs` (default 30 seconds) and optional
`signal`. It removes its timer/listener on every outcome. Cancellation stops waiting;
late storage outcomes stay observed and cannot construct a provider afterwards.
The monotonic deadline is also checked when recovery finishes, before provider or
metrics binding. Synchronous authentication cannot bypass expiry by delaying timer
dispatch. Such work remains non-preemptible, so rejection can occur after the
configured duration; the helper does not promise an exact return-time bound.
Underlying filesystem cleanup still belongs to the store. Startup cancellation does
not continue as a lifetime cancellation subscription after construction succeeds.

Defaults deliberately use `env: {}` and `auditRedaction: { contextKeys: "none" }`.
Opt into overrides and other provider options explicitly through `provider`.
Snapshots and env inputs are captured before asynchronous startup. The helper never
loads signing keys or credentials, and unsigned bootstrap has no signed provenance.

## Refresh, polling and shutdown

`refresh()` preserves the refresher's single-flight, deadlines, diagnostic callback,
ETag and persist-before-activate semantics. A supplied signal cancels that caller's
wait, not shared work. Invalid signatures, rollback or storage failures keep the
last-good provider snapshot. `store` exposes the existing authenticated store for
explicit rollback/history operations; those writes still use its normal locking.

`start()` begins polling immediately. Each completed attempt schedules one next
attempt after `refreshIntervalMs` (default 30 seconds, integer 1..2,147,483,647).
Attempts cannot pile up; concurrent manual refresh shares the active operation.
Poll timers are unreferenced so they do not keep a process alive. Failures are
recorded in provider status and delivered to `refresh.onFailure`; polling continues
without an unhandled rejection. This does not make failure a successful refresh.

`close()` and OpenFeature's `provider.onClose()` share one promise. They stop polling,
close/abort the owned refresher and invoke native provider shutdown once (including
bounded audit flush and metrics/event-handler cleanup). Audit sinks remain
caller-owned and can be shared. Close failures remain rejected on repeated calls;
no timer restarts after close. Stop intake first; a timeout does not forcibly
terminate underlying I/O or cancel an ambiguous storage commit. Failed refresher
construction also closes the acquired provider; setup plus cleanup errors retain
both causes in order through `AggregateError`.

`getStatus()` is the existing frozen `ProviderStatus`, without a new freshness
interpretation. Revalidation, content change and watcher liveness remain distinct;
see `operational-status.md`. There is no evaluation-time network fetch. The helper
adds no browser/Workers support to the Node package root.
