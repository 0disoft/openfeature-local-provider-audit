import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createFileAuditSink,
  createLocalProvider,
  parseJsonFlagSnapshot
} from "@0disoft/openfeature-local-provider";
import { createApplicationFlags } from "./application-flags.js";
import { ownRuntime } from "./runtime-owner.js";

let starts = 0;
let closes = 0;
const shared = ownRuntime(async () => {
  starts++;
  return {
    async close() {
      closes++;
    }
  };
});
const resources = await Promise.all(Array.from({ length: 32 }, () => shared.ready()));
assert.equal(new Set(resources).size, 1);
assert.equal(starts, 1);
assert.equal(shared.close(), shared.close());
await shared.close();
assert.equal(closes, 1);
await assert.rejects(shared.ready(), /closing/);

let unusedStarts = 0;
const unused = ownRuntime(async () => {
  unusedStarts++;
  return { async close() {} };
});
await unused.close();
await assert.rejects(unused.ready(), /closing/);
assert.equal(unusedStarts, 0);

const startupError = new Error("synthetic startup failure");
let attempts = 0;
const retry = ownRuntime(async () => {
  if (++attempts === 1) throw startupError;
  return { async close() {} };
});
await assert.rejects(retry.ready(), (cause) => cause === startupError);
await retry.ready();
await retry.close();
assert.equal(attempts, 2);

let release: ((resource: { close(): Promise<void> }) => void) | undefined;
let lateCloses = 0;
const delayed = ownRuntime(
  () =>
    new Promise<{ close(): Promise<void> }>((resolve) => {
      release = resolve;
    })
);
const lateResult = delayed.ready().then(
  () => "unexpected-ready",
  (cause: unknown) => cause
);
await Promise.resolve();
const lateClose = delayed.close();
assert(release);
release({
  async close() {
    lateCloses++;
  }
});
assert.match(String(await lateResult), /closing/);
await lateClose;
assert.equal(lateCloses, 1);

const cleanupError = new Error("synthetic cleanup failure");
let failedCloses = 0;
const failing = ownRuntime(async () => ({
  async close() {
    failedCloses++;
    throw cleanupError;
  }
}));
await failing.ready();
const failure = failing.close();
assert.equal(failure, failing.close());
await assert.rejects(failure, (cause) => cause === cleanupError);
await assert.rejects(failing.close(), (cause) => cause === cleanupError);
assert.equal(failedCloses, 1);

const directory = await mkdtemp(join(tmpdir(), "of-framework-lifecycle-"));
let flags: ReturnType<typeof createApplicationFlags> | undefined;
try {
  const snapshot = {
    schemaVersion: 1,
    flags: {
      enabled: { type: "boolean", defaultVariant: "on", variants: { on: true, off: false } }
    }
  };
  const flagsPath = join(directory, "flags.json");
  const auditPath = join(directory, "audit.jsonl");
  await writeFile(flagsPath, JSON.stringify(snapshot));
  await OpenFeature.setProviderAndWait(
    "other-application",
    createLocalProvider({ snapshot: parseJsonFlagSnapshot(JSON.stringify(snapshot)) })
  );
  const unrelated = OpenFeature.getClient("other-application");
  const auditSink = createFileAuditSink({ path: auditPath, maxQueueSize: 100 });
  flags = createApplicationFlags("lifecycle-smoke", {
    path: flagsPath,
    persistent: false,
    provider: { auditSink, auditShutdownTimeoutMs: 3_000 }
  });
  const clients = await Promise.all(Array.from({ length: 32 }, () => flags?.getClient()));
  assert.equal(new Set(clients).size, 1);
  await Promise.all(
    clients.map(async (client) => {
      assert(client);
      assert.equal(
        await client.getBooleanValue("enabled", false, {
          targetingKey: "synthetic-private-subject",
          email: "private@example.test"
        }),
        true
      );
    })
  );
  assert.equal(flags.close(), flags.close());
  await flags.close();
  await assert.rejects(flags.getClient(), /closing/);
  assert.equal(auditSink.getStats?.().pendingWrites, 0);
  const auditText = await readFile(auditPath, "utf8");
  const records = auditText
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 32);
  assert(
    records.every((event) => event.context.keyMode === "none" && event.context.keys.length === 0)
  );
  assert(!auditText.includes("synthetic-private-subject"));
  assert(!auditText.includes("private@example.test"));
  assert.equal(await unrelated.getBooleanValue("enabled", false), true);
  console.log(
    JSON.stringify({
      result: "application-lifecycle-passed",
      concurrentClients: 32,
      sharedStarts: starts,
      sharedCloses: closes,
      retryAttempts: attempts,
      lateCloses,
      failedCloses,
      flushedRecords: records.length,
      unrelatedDomainPreserved: true
    })
  );
} finally {
  try {
    await flags?.close();
  } finally {
    try {
      await OpenFeature.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
