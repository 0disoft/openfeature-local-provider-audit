# Watched local file provider

Status: local v2 prerelease; Node package root only.

`createWatchedLocalProvider` connects the existing JSON/YAML file watcher to an
owned reloadable provider. The factory explicitly starts watching, reads/validates
the initial file once and returns only after the provider is ready. Unlike the
signed-source helper's opt-in polling, there is no separate `start()` call.
It does not register a global OpenFeature provider or introduce a delivery server.

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { createWatchedLocalProvider } from "@0disoft/openfeature-local-provider";

// flagsPath is an application-owned real JSON/YAML configuration path.
const runtime = await createWatchedLocalProvider({
  path: flagsPath,
  consistencyPollIntervalMs: 1_000,
  provider: { staleAfterMs: 60_000 },
  onFailure({ kind, cause }) { reportConfigurationFailure(kind, cause); }
});
await OpenFeature.setProviderAndWait(runtime.provider);
// Optional explicit revalidation, even if the file content is unchanged:
await runtime.reload();
const status = runtime.getStatus();
// Stop request intake first. SDK shutdown invokes the same owned close operation.
await runtime.close();
```

## Input and trust

The top-level path/format/encoding/maxBytes/debounceMs/consistencyPollIntervalMs/
persistent options are the existing watcher options, with the same defaults and
limits. Automatic monitoring handles atomic replacement/projected volumes as the
existing watcher does. Paths/options are captured by that watcher; provider env
and audit options are captured before asynchronous startup. Evaluation uses memory,
not evaluation-time file reads.

The file is an unsigned local snapshot. Signed provenance cannot be seeded through
`provider`; updates use no signed provenance. For authenticated source delivery
and replay-protected restart recovery, use `createManagedLocalProvider` instead.
Defaults omit ambient environment overrides and context key names. Explicitly opt
in through provider.env, provider.overridesJson or provider.auditRedaction as needed.
An unavailable/invalid initial file rejects, without manufacturing a bootstrap.

The helper inherits native watcher startup/read semantics and byte bounds. It adds
no filesystem timeout or AbortSignal contract; it cannot preempt a blocked native
filesystem operation. Keep paths on trusted storage. Low-level loader/watcher APIs
remain available and retain their caller-owned lifecycle.

## Updates and diagnostics

Native automatic notifications still suppress unchanged content. They do not
renew provider freshness. `reload()` explicitly forwards an unchanged read, records
a successful provider validation and resets consecutive refresh failures; it does
not change lastChangedAt or emit a configuration-change event for identical content.
See `operational-status.md`; watcher liveness and last validation are distinct.

Load/parse/watch errors count as load failures. Provider application failures
already counted by the provider are not counted again. A shared automatic/manual
reload rejection is diagnosed once. Concurrent explicit reloads share one promise;
completed attempts release that reservation before diagnostics can request recovery. The original cause reaches optional onFailure;
synchronous throws and rejected diagnostics promises cannot poison reloads. No
raw error/path/context is added to provider status or logged by the helper.

Rejected provider application is rethrown to the watcher, so its last accepted
snapshot does not advance ahead of the provider. This preserves retries after a
transient pending transaction. Failed updates keep the last-good provider snapshot.

## Shutdown

Controller close() and provider.onClose() return one shared promise. Watch handles
and debounce/poll resources are closed once; late snapshot callbacks cannot apply
new state. Provider metrics/events and bounded audit flush run even when watcher
release throws. Two cleanup errors are retained as AggregateError in watcher,
provider order, with the first as cause; single errors preserve their identity.
Repeated close never retries an ambiguous release or flush.

New reloads after close reject. Closing an in-flight reload prevents delivery but
does not forcibly cancel its filesystem read; the existing loader owns handle
cleanup when that read settles. Audit sinks stay caller-owned and may be shared.
Failure during startup after provider acquisition also releases that provider,
retaining setup and cleanup errors together. No persistent watcher can be obtained
from a failed constructor; the underlying watcher owns its startup rollback.
