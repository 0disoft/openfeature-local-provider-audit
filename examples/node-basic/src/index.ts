import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createFileAuditSink,
  createReloadableLocalProvider,
  loadFlagSnapshotFile,
  replayEvaluationFixture,
  watchFlagSnapshotFile,
  type AuditEvent,
  type FlagSnapshotFileWatcher,
  type ReloadableLocalProvider
} from "@0disoft/openfeature-local-provider";

const sourceSnapshotText = await readFile(new URL("../flags.json", import.meta.url), "utf8");
const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-node-basic-"));
const flagsPath = join(tempDirectory, "flags.json");
const nextFlagsPath = join(tempDirectory, "flags.next.json");
const auditPath = join(tempDirectory, "audit.jsonl");
let watcher: FlagSnapshotFileWatcher | undefined;

try {
  await writeFile(flagsPath, sourceSnapshotText, "utf8");

  const snapshot = await loadFlagSnapshotFile(flagsPath);
  const auditSink = createFileAuditSink({
    path: auditPath,
    maxQueueSize: 100,
    queueOverflowPolicy: "reject"
  });
  const provider = createReloadableLocalProvider({
    snapshot,
    overridesJson: JSON.stringify({ "checkout.enabled": false }),
    auditSink,
    auditRedaction: { contextKeys: "none" }
  });

  await OpenFeature.setProviderAndWait(provider);

  const client = OpenFeature.getClient();
  const targetingKey = "sample-cohort-alpha";
  const overrideValue = await client.getBooleanValue("checkout.enabled", true, {
    targetingKey,
    cohort: "sample-alpha"
  });
  const rolloutValue = await client.getBooleanValue("checkout.rollout", false, {
    targetingKey,
    cohort: "sample-alpha"
  });
  const replay = replayEvaluationFixture({
    schemaVersion: 1,
    name: "node-basic-rollout",
    snapshot,
    request: {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean",
      targetingKey
    },
    expected: {
      value: true,
      variant: "on",
      bucket: 5019,
      reason: "SPLIT",
      source: "file"
    }
  });

  let reloadError: unknown;
  watcher = await watchFlagSnapshotFile({
    path: flagsPath,
    debounceMs: 25,
    persistent: false,
    onSnapshot(nextSnapshot) {
      provider.updateSnapshot(nextSnapshot);
    },
    onError(error) {
      reloadError = error;
    }
  });

  const updatedSnapshot = JSON.parse(sourceSnapshotText) as {
    flags: Record<string, unknown>;
  };
  updatedSnapshot.flags["checkout.reloaded"] = {
    type: "boolean",
    defaultVariant: "on",
    variants: {
      on: true,
      off: false
    }
  };
  await writeFile(nextFlagsPath, JSON.stringify(updatedSnapshot, null, 2), "utf8");
  await rename(nextFlagsPath, flagsPath);
  await waitForReload(provider, () => reloadError);

  const reloadedValue = await client.getBooleanValue("checkout.reloaded", false, {
    targetingKey,
    cohort: "sample-alpha"
  });

  await auditSink.flush?.();
  const auditText = await readFile(auditPath, "utf8");
  const auditEvents = auditText
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as AuditEvent);

  assertExampleResult({
    overrideValue,
    rolloutValue,
    replayPassed: replay.passed,
    reloadedValue,
    auditText,
    auditEvents
  });

  console.log(
    JSON.stringify({
      override: overrideValue,
      rollout: rolloutValue,
      replay: replay.passed,
      reload: reloadedValue,
      auditContextKeyMode: "none",
      auditEvents: auditEvents.length
    })
  );
} finally {
  watcher?.close();
  await rm(tempDirectory, { recursive: true, force: true });
}

interface ExampleResult {
  readonly overrideValue: boolean;
  readonly rolloutValue: boolean;
  readonly replayPassed: boolean;
  readonly reloadedValue: boolean;
  readonly auditText: string;
  readonly auditEvents: readonly AuditEvent[];
}

function assertExampleResult(result: ExampleResult): void {
  if (result.overrideValue !== false) {
    throw new Error("Explicit JSON override did not win over the file value.");
  }
  if (!result.rolloutValue || !result.replayPassed) {
    throw new Error("Deterministic rollout or replay validation failed.");
  }
  if (!result.reloadedValue) {
    throw new Error("Atomic flag snapshot reload did not update future evaluations.");
  }
  if (result.auditEvents.length !== 3) {
    throw new Error(`Expected 3 audit events, received ${result.auditEvents.length}.`);
  }
  if (
    result.auditEvents.some(
      (event) => event.context.keyMode !== "none" || event.context.keys.length !== 0
    )
  ) {
    throw new Error("Strict audit redaction exposed context key names.");
  }
  for (const forbiddenText of ["cohort", "sample-alpha", "sample-cohort-alpha"]) {
    if (result.auditText.includes(forbiddenText)) {
      throw new Error(`Strict audit redaction exposed forbidden context text: ${forbiddenText}.`);
    }
  }
}

async function waitForReload(
  provider: ReloadableLocalProvider,
  getReloadError: () => unknown
): Promise<void> {
  const startedAt = Date.now();
  while (provider.getSnapshot().flags["checkout.reloaded"] === undefined) {
    const reloadError = getReloadError();
    if (reloadError !== undefined) {
      throw reloadError;
    }
    if (Date.now() - startedAt > 5_000) {
      throw new Error("Timed out waiting for snapshot reload.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
