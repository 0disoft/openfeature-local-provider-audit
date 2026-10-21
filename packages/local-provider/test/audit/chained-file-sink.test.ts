import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { appendFile, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { ErrorCode, OpenFeature } from "@openfeature/server-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChainedFileAuditSink,
  createChainedAuditEvent,
  createAuditEvent,
  createAuditChainCheckpoint,
  createLocalProvider,
  createSnapshotVerifier,
  signFlagSnapshot,
  evaluateFlag,
  verifyAuditChain,
  verifyAuditChainRecord,
  type ChainedAuditEvent
} from "../../src/index.js";
import { runCli } from "../../src/cli/run.js";
import { staticSnapshot } from "../fixtures.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
let directory: string;
function event() {
  const snapshot = { schemaVersion: 1 as const, flags: {} };
  const request = { flagKey: "feature", expectedType: "boolean" as const, defaultValue: false };
  return createAuditEvent({
    snapshot,
    request,
    result: evaluateFlag(snapshot, request),
    providerName: "writer"
  });
}
function sink(extra = {}) {
  return createChainedFileAuditSink({ directory, chainId: "writer/test", ...extra });
}
async function records(files: readonly string[]) {
  const result: ChainedAuditEvent[] = [];
  for (const file of files)
    result.push(
      ...(await readFile(join(directory, file), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as ChainedAuditEvent)
    );
  return result;
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-chain-writer-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-chain-writer-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

describe("chained file audit sink", () => {
  it("preserves signed SDK origins from a trusted checkpoint and returns defaults on storage failure", async () => {
    const keys = generateKeyPairSync("ed25519");
    const artifact = signFlagSnapshot({
      snapshot: staticSnapshot,
      privateKey: keys.privateKey,
      keyId: "release",
      audience: "sdk-chain-test",
      sequence: 1,
      issuedAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000
    });
    const verified = createSnapshotVerifier({
      audience: "sdk-chain-test",
      trustedKeys: { release: keys.publicKey }
    }).verify(Buffer.from(artifact));
    const genesis = createAuditChainCheckpoint("writer/test");
    const trustedStart = verifyAuditChainRecord(createChainedAuditEvent(event(), genesis), genesis);
    const target = sink({ initialCheckpoint: trustedStart });
    const provider = createLocalProvider({
      ...verified,
      env: {},
      auditSink: target,
      auditFailurePolicy: "returnDefault",
      auditTimeoutMs: 10_000,
      auditRedaction: { contextKeys: "none" }
    });
    const domain = "chained-audit-sdk";
    await OpenFeature.setProviderAndWait(domain, provider);
    try {
      const client = OpenFeature.getClient(domain);
      expect(
        await client.getBooleanValue("checkout.enabled", false, {
          targetingKey: "private-subject",
          email: "private-mail"
        })
      ).toBe(true);
      const checkpoint = await target.getCheckpoint();
      expect(checkpoint.start).toEqual(trustedStart);
      expect(checkpoint.head.sequence).toBe(2);
      const rows = await records(checkpoint.files);
      expect(rows[0]?.event.provenance).toEqual(verified.provenance);
      expect(rows[0]?.event.snapshotHash).toBe(verified.provenance.snapshotHash);
      expect(JSON.stringify(rows)).not.toContain("private-");
      await writeFile(join(directory, "start.json"), JSON.stringify(trustedStart));
      await writeFile(join(directory, "head.json"), JSON.stringify(checkpoint.head));
      let stdout = "";
      const stderr = vi.fn();
      expect(
        await runCli(
          [
            "audit-verify",
            ...checkpoint.files,
            "--start",
            "start.json",
            "--expect-head",
            "head.json"
          ],
          {
            cwd: directory,
            stdout(text) {
              stdout += text;
            },
            stderr
          }
        )
      ).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ records: 1, checkpointMatched: true });
      expect(stderr).not.toHaveBeenCalled();
      // Keep the evidence intact: a partial append must fail confirmation, never reset the log.
      const file = join(directory, checkpoint.files[0] ?? "");
      await appendFile(file, '{"partial":');
      const corrupted = await readFile(file);
      expect(await client.getBooleanDetails("checkout.enabled", false)).toMatchObject({
        value: false,
        reason: "ERROR",
        errorCode: ErrorCode.GENERAL
      });
      expect(provider.getStatus().audit).toMatchObject({
        resolvedWrites: 1,
        failedWrites: 1,
        pendingWrites: 0
      });
      expect(await readFile(file)).toEqual(corrupted);
      await expect(target.flush?.()).rejects.toThrow();
      await expect(target.getCheckpoint()).rejects.toThrow();
    } finally {
      await OpenFeature.clearProviders();
    }
  });

  it("serializes shared instances, captures input, restarts and exports verified retained checkpoints", async () => {
    const first = sink(),
      second = sink();
    const input = { ...event() };
    const pending = first.write(input);
    input.flagKey = "changed";
    await pending;
    await Promise.all([
      first.write(event()),
      second.writeConfirmed?.(event()),
      first.write(event())
    ]);
    const checkpoint = await second.getCheckpoint();
    expect(checkpoint.head.sequence).toBe(4);
    const rows = await records(checkpoint.files);
    expect(rows[0]?.event.flagKey).toBe("feature");
    expect(
      verifyAuditChain(rows, { start: checkpoint.start, expectedHead: checkpoint.head }).records
    ).toBe(4);
    const restarted = sink();
    await restarted.write(event());
    expect((await restarted.getCheckpoint()).head.sequence).toBe(5);
    await restarted.write({ ...event(), variant: "가".repeat(10_000) });
    await restarted.write(event());
    expect((await restarted.getCheckpoint()).head.sequence).toBe(7);
  });

  it("rotates immutable segment names and retains an explicit prefix/head with bounded files", async () => {
    const target = sink({ maxSegmentBytes: 1, maxSegments: 2 });
    for (let index = 0; index < 5; index++) await target.write(event());
    const checkpoint = await target.getCheckpoint();
    expect(checkpoint.start.sequence).toBe(3);
    expect(checkpoint.head.sequence).toBe(5);
    expect(checkpoint.files).toEqual(["segment-4.jsonl", "segment-5.jsonl"]);
    expect((await readdir(directory)).sort()).toEqual(
      ["manifest.json", ...checkpoint.files].sort()
    );
    expect(
      verifyAuditChain(await records(checkpoint.files), {
        start: checkpoint.start,
        expectedHead: checkpoint.head
      }).records
    ).toBe(2);
  });

  it("adopts a complete unacknowledged tail and a complete rotation orphan after restart", async () => {
    const first = sink();
    await first.write(event());
    const committed = await first.getCheckpoint();
    const unacknowledged = createChainedAuditEvent(event(), committed.head);
    await appendFile(
      join(directory, committed.files[0] ?? ""),
      `${JSON.stringify(unacknowledged)}\n`
    );
    const restarted = sink();
    await restarted.write(event());
    expect((await restarted.getCheckpoint()).head.sequence).toBe(3);
    const beforeRotation = await restarted.getCheckpoint();
    const orphan = createChainedAuditEvent(event(), beforeRotation.head);
    await writeFile(join(directory, "segment-4.jsonl"), `${JSON.stringify(orphan)}\n`);
    await sink().write(event());
    expect((await sink().getCheckpoint()).head.sequence).toBe(5);
  });

  it("recovers a complete append after manifest replacement failed, preserving ambiguity and sequence", async () => {
    const target = sink();
    await target.write(event());
    vi.mocked(rename).mockRejectedValueOnce(new Error("private path"));
    await expect(target.write(event())).rejects.toThrow("Chained audit storage is unavailable.");
    await expect(target.flush?.()).rejects.toThrow();
    await sink().write(event());
    expect((await sink().getCheckpoint()).head.sequence).toBe(3);
    expect((await readdir(directory)).some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("fails closed on partial append, truncation, missing manifest and mixed plain data", async () => {
    const target = sink();
    await target.write(event());
    const checkpoint = await target.getCheckpoint(),
      file = checkpoint.files[0] ?? "";
    const original = await readFile(join(directory, file));
    await appendFile(join(directory, file), '{"partial":');
    await expect(sink().write(event())).rejects.toThrow();
    expect((await readFile(join(directory, file))).length).toBeGreaterThan(original.length);
    await writeFile(join(directory, file), original.subarray(0, original.length - 1));
    await expect(sink().write(event())).rejects.toThrow();
    await writeFile(join(directory, file), original);
    await rm(join(directory, "manifest.json"));
    await expect(sink().write(event())).rejects.toThrow();
    const mixed = join(directory, "plain");
    await import("node:fs/promises").then((fs) => fs.mkdir(mixed));
    await writeFile(join(mixed, "audit.jsonl"), `${JSON.stringify(event())}\n`);
    await expect(sink({ directory: mixed }).write(event())).rejects.toThrow();
  });

  it("coordinates independent real Node processes under the same advisory lock", async () => {
    const script = `const api = await import(${JSON.stringify(new URL("../../dist/index.js", import.meta.url).href)});
      const sink = api.createChainedFileAuditSink({ directory: ${JSON.stringify(directory)}, chainId: "writer/test", lockTimeoutMs: 10000 });
      const snapshot = { schemaVersion: 1, flags: {} }, request = { flagKey: "feature", expectedType: "boolean", defaultValue: false };
      for (let index=0; index<5; index++) await sink.write(api.createAuditEvent({ snapshot, request, result: api.evaluateFlag(snapshot, request), providerName: "child" }));
      await sink.flush();`;
    await Promise.all([
      promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]),
      promisify(execFile)(process.execPath, ["--input-type=module", "-e", script])
    ]);
    const checkpoint = await sink().getCheckpoint();
    expect(checkpoint.head.sequence).toBe(10);
    expect(
      verifyAuditChain(await records(checkpoint.files), {
        start: checkpoint.start,
        expectedHead: checkpoint.head
      }).records
    ).toBe(10);
  });

  it("rejects unsafe settings and queue overflow, and preserves foreign lock ownership", async () => {
    for (const extra of [
      { lock: false },
      { staleLockMs: 1 },
      { queueOverflowPolicy: "dropNewest" },
      { maxSegments: 0 },
      { maxVerificationBytes: 1 }
    ])
      expect(() => sink(extra)).toThrow();
    const target = sink({ maxQueueSize: 1 });
    const running = target.write(event());
    await expect(target.write(event())).rejects.toThrow("queue is full");
    await running;
    expect(target.getStats?.().rejectedWrites).toBe(1);
    await writeFile(join(directory, "manifest.json.lock"), "foreign-owner\n");
    await expect(sink({ lockTimeoutMs: 0 }).write(event())).rejects.toThrow();
    expect(await readFile(join(directory, "manifest.json.lock"), "utf8")).toBe("foreign-owner\n");
  });
});
