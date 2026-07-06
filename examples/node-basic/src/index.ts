import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createFileAuditSink,
  createLocalProvider,
  parseJsonFlagSnapshot
} from "@0disoft/openfeature-local-provider";

const snapshotText = await readFile(new URL("../flags.json", import.meta.url), "utf8");
const snapshot = parseJsonFlagSnapshot(snapshotText);
const auditPath = join(tmpdir(), "openfeature-local-provider-node-basic-audit.jsonl");

await OpenFeature.setProviderAndWait(
  createLocalProvider({
    snapshot,
    auditSink: createFileAuditSink({ path: auditPath })
  })
);

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout.enabled", false, {
  targetingKey: "synthetic-user",
  email: "synthetic@example.test"
});

console.log(JSON.stringify({ "checkout.enabled": enabled }));
