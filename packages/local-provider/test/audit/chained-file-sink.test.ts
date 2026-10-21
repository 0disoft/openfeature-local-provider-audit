import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChainedFileAuditSink,
  createChainedAuditEvent,
  createAuditEvent,
  evaluateFlag,
  verifyAuditChain,
  type ChainedAuditEvent
} from "../../src/index.js";

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
