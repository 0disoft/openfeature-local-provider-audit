import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createFileAuditSink,
  createLocalProvider,
  parseJsonFlagSnapshot,
  replayEvaluationFixture
} from "@0disoft/openfeature-local-provider";

const snapshotText = await readFile(new URL("../flags.json", import.meta.url), "utf8");
const snapshot = parseJsonFlagSnapshot(snapshotText);
const auditPath = join(tmpdir(), "openfeature-local-provider-node-basic-audit.jsonl");
const auditSink = createFileAuditSink({ path: auditPath });

await OpenFeature.setProviderAndWait(
  createLocalProvider({
    snapshot,
    auditSink
  })
);

const client = OpenFeature.getClient();
const targetingKey = "sample-cohort-alpha";
const enabled = await client.getBooleanValue("checkout.rollout", false, {
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

await auditSink.flush?.();

console.log(
  JSON.stringify({
    "checkout.rollout": enabled,
    replay: replay.passed
  })
);
