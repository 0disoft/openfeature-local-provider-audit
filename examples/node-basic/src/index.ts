import { readFile } from "node:fs/promises";
import { OpenFeature } from "@openfeature/server-sdk";
import { createLocalProvider, parseJsonFlagSnapshot } from "@0disoft/openfeature-local-provider";

const snapshotText = await readFile(new URL("../flags.json", import.meta.url), "utf8");
const snapshot = parseJsonFlagSnapshot(snapshotText);

await OpenFeature.setProviderAndWait(createLocalProvider({ snapshot }));

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue("checkout.enabled", false);

console.log(JSON.stringify({ "checkout.enabled": enabled }));
