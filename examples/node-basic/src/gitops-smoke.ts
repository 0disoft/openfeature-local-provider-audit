import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createFileAuditSink,
  type AuditEvent,
  type FlagSnapshot
} from "@0disoft/openfeature-local-provider";
import {
  createGitOpsConsumer,
  createRollbackRelease,
  createSignedRelease,
  type GitOpsConsumerOptions
} from "./gitops.js";

const directory = await mkdtemp(join(tmpdir(), "openfeature-gitops-"));
const keys = generateKeyPairSync("ed25519");
const audience = "gitops/local";
const verification = { audience, trustedKeys: { release: keys.publicKey }, minSequence: 1 };
const bootstrap: FlagSnapshot = {
  schemaVersion: 1,
  flags: {
    "checkout.enabled": {
      type: "boolean",
      variants: { on: true, off: false },
      defaultVariant: "off"
    }
  }
};
const auditPath = join(directory, "audit.jsonl");
const recoveryPath = join(directory, "recovery.json");
const auditSink = createFileAuditSink({ path: auditPath });
let consumer: Awaited<ReturnType<typeof createGitOpsConsumer>> | undefined;
let artifact = "";
let etag = '"unpublished"';
let requests = 0;
let conditionalHits = 0;
let lastValidator: string | undefined;
const server = createServer();
const signing = (sequence: number) => ({
  privateKey: keys.privateKey,
  keyId: "release",
  audience,
  sequence,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000
});

try {
  // Real ephemeral TLS credentials; no committed private key or deployed service.
  const windowsOpenSsl = join(
    process.env.ProgramFiles ?? "C:/Program Files",
    "Git/usr/bin/openssl.exe"
  );
  const openssl =
    process.platform === "win32" && existsSync(windowsOpenSsl) ? windowsOpenSsl : "openssl";
  execFileSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(directory, "tls.key"),
      "-out",
      join(directory, "tls.pem")
    ],
    { stdio: "ignore", timeout: 15_000 }
  );
  server.setSecureContext({
    key: await readFile(join(directory, "tls.key")),
    cert: await readFile(join(directory, "tls.pem"))
  });
  server.on("request", (request, response) => {
    requests++;
    lastValidator = request.headers["if-none-match"];
    if (lastValidator === etag) {
      conditionalHits++;
      response.writeHead(304).end();
    } else response.writeHead(200, { etag, "content-type": "application/jose" }).end(artifact);
  });
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing local TLS address.");
  const options: GitOpsConsumerOptions = {
    url: `https://127.0.0.1:${address.port}/flags.jws`,
    ca: await readFile(join(directory, "tls.pem"), "utf8"),
    recoveryPath,
    verification,
    safeBootstrap: bootstrap,
    auditSink
  };

  const enabledPath = join(directory, "enabled.json"),
    disabledPath = join(directory, "disabled.yaml");
  await writeFile(
    enabledPath,
    JSON.stringify({
      ...bootstrap,
      flags: {
        "checkout.enabled": {
          type: "boolean",
          variants: { on: true, off: false },
          defaultVariant: "on"
        }
      }
    }),
    { mode: 0o600 }
  );
  await writeFile(
    disabledPath,
    "schemaVersion: 1\nflags:\n  checkout.enabled:\n    type: boolean\n    variants: { on: true, off: false }\n    defaultVariant: off\n",
    { mode: 0o600 }
  );

  await assert.rejects(createGitOpsConsumer(options), /Recovery state is missing/);
  assert.equal(requests, 0);
  consumer = await createGitOpsConsumer({ ...options, allowFirstStart: true });
  await OpenFeature.setProviderAndWait("gitops", consumer.provider);
  const client = OpenFeature.getClient("gitops");
  assert.equal(await client.getBooleanValue("checkout.enabled", false), false);

  artifact = await createSignedRelease(enabledPath, signing(1));
  etag = '"release-1"';
  await consumer.refresher.refresh();
  assert.equal(
    await client.getBooleanValue("checkout.enabled", false, {
      targetingKey: "sample-cohort-alpha"
    }),
    true
  );
  const first = consumer.provider.getStatus().provenance;
  assert.equal(first?.sequence, 1);
  await consumer.refresher.refresh();
  assert.equal(conditionalHits, 1);
  assert.equal((await consumer.store.load())?.history.length, 1);

  artifact = await createSignedRelease(disabledPath, signing(2));
  etag = '"release-2"';
  await consumer.refresher.refresh();
  assert.equal(await client.getBooleanValue("checkout.enabled", false), false);
  await assert.rejects(createRollbackRelease(consumer.store, 1, signing(2)), /higher sequence/);
  await assert.rejects(
    createRollbackRelease(consumer.store, 99, signing(3)),
    /authenticated history/
  );
  artifact = await createRollbackRelease(consumer.store, 1, signing(3));
  etag = '"release-3"';
  await consumer.refresher.refresh();
  const restored = consumer.provider.getStatus().provenance;
  assert.equal(restored?.sequence, 3);
  assert.equal(restored?.snapshotHash, first?.snapshotHash);
  assert.notEqual(restored?.artifactHash, first?.artifactHash);
  assert.equal(await client.getBooleanValue("checkout.enabled", false), true);

  consumer.refresher.close();
  const beforeRestart = requests;
  consumer = await createGitOpsConsumer(options);
  await OpenFeature.setProviderAndWait("gitops", consumer.provider);
  assert.equal(await client.getBooleanValue("checkout.enabled", false), true);
  assert.equal(consumer.provider.getStatus().provenance?.sequence, 3);
  assert.equal(requests, beforeRestart);

  // A valid old signature and a corrupt new signature both preserve the last good state.
  artifact = await createSignedRelease(disabledPath, signing(2));
  etag = '"stale-release"';
  await assert.rejects(consumer.refresher.refresh(), /Signed snapshot verification failed/);
  artifact = artifact.slice(0, -2);
  etag = '"corrupt-release"';
  await assert.rejects(consumer.refresher.refresh(), /Signed snapshot verification failed/);
  assert.equal(lastValidator, undefined); // A fresh controller did not adopt rejected ETags.
  assert.equal(consumer.provider.getStatus().provenance?.sequence, 3);
  const beforeEvaluations = requests;
  for (let index = 0; index < 10; index++)
    assert.equal(await client.getBooleanValue("checkout.enabled", false), true);
  assert.equal(requests, beforeEvaluations);
  consumer.refresher.close();
  await OpenFeature.clearProviders();
  await auditSink.flush?.();
  const text = await readFile(auditPath, "utf8");
  const events = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as AuditEvent);
  assert(events.some((event) => event.provenance?.sequence === 1));
  assert(events.some((event) => event.provenance?.sequence === 2));
  assert(events.some((event) => event.provenance?.sequence === 3));
  assert(!text.includes("sample-cohort-alpha"));
  console.log(
    JSON.stringify({
      recipe: "gitops-signed",
      releases: [1, 2, 3],
      rollbackContentRestored: true,
      restartRecovered: true,
      conditionalHits,
      rejectedUpdates: 2,
      evaluationsWithoutFetch: 10,
      auditEvents: events.length,
      node: process.version,
      platform: process.platform
    })
  );
} finally {
  consumer?.refresher.close();
  try {
    await OpenFeature.clearProviders();
  } finally {
    try {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((yes, no) => server.close((error) => (error ? no(error) : yes())));
    } finally {
      assert(resolve(directory).startsWith(join(resolve(tmpdir()), "openfeature-gitops-")));
      await rm(directory, { recursive: true, force: true });
    }
  }
}
