# Own one flag runtime per application

The copyable Node examples are
[`application-flags.ts`](../../examples/node-basic/src/application-flags.ts) and
[`runtime-owner.ts`](../../examples/node-basic/src/runtime-owner.ts). They reuse the
existing watched provider and OpenFeature SDK, with no extra framework dependency.
Copy both into server-only application code and adjust their relative import paths.
They are examples, not new npm exports or a new framework package.

## Start with the shared service

```ts
import { resolve } from "node:path";
import { createFileAuditSink } from "@0disoft/openfeature-local-provider";
import { createApplicationFlags } from "./application-flags.js";

export const flags = createApplicationFlags("checkout-service", {
  path: resolve("config/flags.json"),
  provider: {
    auditSink: createFileAuditSink({ path: resolve("data/flag-audit.jsonl"), maxQueueSize: 5_000 }),
    auditShutdownTimeoutMs: 3_000
  }
});
```

Supply a real configuration file and service-owned audit directory with appropriate
permissions. Without `auditSink`, no audit persistence is enabled. The example does
not read ambient flag overrides or include context key names. Only pass explicitly
approved context attributes to evaluation; never spread an HTTP request or session.
Do authentication and authorization in the application before using a flag to select
behavior. A feature flag is not an authorization mechanism.

`await flags.getClient()` initializes once and returns the same domain-bound client
to concurrent callers. A failed initialization rejects with its original cause and
allows a later retry. If SDK registration fails after the watcher was created, the
factory closes it; registration plus cleanup failure retains both causes. Use one
owner per unique OpenFeature domain in a process. Do not register another provider
into that domain while this owner is active.

`flags.close()` is single-flight, rejects new client acquisition immediately, and
waits for an already-started initialization to close any late-acquired runtime.
It does not initialize an unused owner. Repeated close returns the same failure if
cleanup failed; it never reopens the runtime. Already returned SDK clients cannot
be revoked by this wrapper: stop intake and drain in-flight application work first.
It closes its own watcher/provider rather than calling process-wide `OpenFeature.close()`.
Other SDK domains stay active. A closed SDK domain may retain a reference to its
closed provider until the application's SDK lifecycle ends; do not keep using it.

The helper does not register process signals, force process exit, own an HTTP
server, or cancel uncooperative I/O. Its factory and provider retain their own
startup/flush limits. A three-second audit wait is not proof that every write is
durable or that a stalled filesystem operation stopped. See
[runtime recipes](../ops/runtime-recipes.md) for shutdown and audit policy choices.

## NestJS singleton service

Use a default singleton provider, not a request-scoped provider. Return the async
initialization promise so startup errors prevent the application from serving.

```ts
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { flags } from "./flags.js";

@Injectable()
export class FlagsService implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> { await flags.getClient(); }
  getClient() { return flags.getClient(); }
  onApplicationShutdown(): Promise<void> { return flags.close(); }
}
```

Register/export `FlagsService` from the application's module. Use
`onApplicationShutdown` after connection shutdown, rather than closing the provider
from `onModuleDestroy` while requests may still need it. Drain application background
work as part of the application's shutdown sequence as well. Enable Nest's own
shutdown hooks once in bootstrap when signal handling is wanted, or explicitly
`await app.close()` in tests/supervision. Do not add a second provider-owned signal
handler. Windows process termination cannot be treated as a guaranteed flush hook.
See [Nest lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events).

## Next.js App Router, self-hosted Node only

Use this watcher/file-audit recipe only in a long-lived Node process with persistent,
service-owned files. It is not an Edge-runtime or arbitrary serverless-storage
support claim. The separate `/core` entry is the appropriate boundary for portable
evaluation with an explicitly supplied snapshot.

In `server/flags.ts`, prevent client bundling and preserve a single application owner
across development module reloads. Using `createApplicationFlags` without an audit
sink below intentionally performs no persistent audit writes; configure the sink as
above if the deployment has suitable persistent storage.

```ts
import "server-only";
import { resolve } from "node:path";
import { createApplicationFlags } from "./application-flags.js";

const appGlobal = globalThis as typeof globalThis & {
  checkoutFlags?: ReturnType<typeof createApplicationFlags>;
};
export const flags = appGlobal.checkoutFlags ??= createApplicationFlags(
  "checkout-service", { path: resolve("config/flags.json") }
);
```

The global key and domain are application-owned; choose distinct names for separate
applications in one process. This cache holds the original factory configuration:
restart the process after changing its path/options or this helper's code. Normal
flag-file updates still use the existing watcher. Never retain request-specific
context in this global owner.

Eager startup is optional. In root `instrumentation.ts` (or `src/instrumentation.ts`
when the app uses `src`), dynamically import Node-only code after checking runtime:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { flags } = await import("./server/flags.js");
    await flags.getClient();
  }
}
```

In server request code, obtain that client and evaluate normally. Do not close the
shared provider in a route's `finally` block or cache flag results with `use cache`:
either would interfere with subsequent requests/configuration changes. Keep the
Node package root out of Edge/client bundles. The self-hosted application supervisor
must stop/drain work and await `flags.close()`; `register()` is a startup hook, not a
universal shutdown guarantee. Environments that freeze or kill instances cannot rely
on a final file-audit flush. The adapter does not install global signals to conceal
that limitation. See [Next instrumentation](https://nextjs.org/docs/app/guides/instrumentation).

## Run the lifecycle proof

```sh
corepack pnpm run smoke:lifecycle
```

The oneshot smoke uses the real watched provider, OpenFeature domains and a temporary
file-audit sink. It verifies 32 concurrent clients share one result, all 32 redacted
events are flushed on close, and an unrelated SDK domain still evaluates afterward.
Deterministic deferred factories separately check one startup/cleanup, retry after
failure, idle close, close during startup, and repeated cleanup rejection identity.
All files and owned runtimes are cleaned up. It starts no HTTP server and installs
no signal handler, framework package or new hosted CI job.

Validation is of the shared Node adapter and lifecycle contracts. NestJS/Next.js
snippets follow their linked lifecycle APIs; full framework applications and their
hosting environments have not been executed or certified by this smoke.
