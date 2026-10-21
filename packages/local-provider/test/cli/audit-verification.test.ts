import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuditChainCheckpoint,
  createChainedAuditEvent,
  verifyAuditChainRecord,
  createAuditEvent,
  evaluateFlag
} from "../../src/index.js";
import { runCli } from "../../src/cli/run.js";
import { staticSnapshot } from "../fixtures.js";

let directory: string;
const start = createAuditChainCheckpoint("cli/production");
function record(previous = start, variant?: string) {
  const request = {
    flagKey: "checkout.enabled",
    expectedType: "boolean" as const,
    defaultValue: false
  };
  return createChainedAuditEvent(
    {
      ...createAuditEvent({
        snapshot: staticSnapshot,
        providerName: "cli",
        request,
        result: evaluateFlag(staticSnapshot, request)
      }),
      ...(variant !== undefined ? { variant } : {})
    },
    previous
  );
}
async function run(args: string[]) {
  let stdout = "",
    stderr = "";
  const code = await runCli(["audit-verify", ...args], {
    cwd: directory,
    stdout(text) {
      stdout += text;
    },
    stderr(text) {
      stderr += text;
    }
  });
  return { code, stdout, stderr };
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-chain-cli-"));
});
afterEach(async () => {
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-chain-cli-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
describe("audit verification CLI", () => {
  it("verifies ordered files and externally supplied suffix/head checkpoints without exposing records", async () => {
    const first = record(),
      one = verifyAuditChainRecord(first, start),
      second = record(one),
      head = verifyAuditChainRecord(second, one);
    await writeFile(join(directory, "old.jsonl"), `${JSON.stringify(first)}\r\n`);
    await writeFile(join(directory, "current.jsonl"), `${JSON.stringify(second)}\n`);
    await writeFile(join(directory, "start.json"), JSON.stringify(one));
    await writeFile(join(directory, "head.json"), JSON.stringify(head));
    const all = await run([
      "old.jsonl",
      "current.jsonl",
      "--chain-id",
      start.chainId,
      "--expect-head",
      "head.json"
    ]);
    expect(all.code).toBe(0);
    expect(JSON.parse(all.stdout)).toMatchObject({ records: 2, head, checkpointMatched: true });
    expect(all.stdout).not.toContain("checkout.enabled");
    expect(all.stderr).toBe("");
    expect(
      (await run(["current.jsonl", "--start", "start.json", "--expect-head", "head.json"])).code
    ).toBe(0);
    expect((await run(["current.jsonl", "old.jsonl", "--chain-id", start.chainId])).code).toBe(1);
  });
  it("streams Unicode across chunk boundaries and rejects malformed/partial/oversize input generically", async () => {
    const large = record(start, "가".repeat(22_000));
    await writeFile(join(directory, "unicode.jsonl"), `${JSON.stringify(large)}\n`);
    expect((await run(["unicode.jsonl", "--chain-id", start.chainId])).code).toBe(0);
    for (const args of [
      ["--max-bytes", "100"],
      ["--max-record-bytes", "100"],
      ["--max-records", "0"]
    ]) {
      expect((await run(["unicode.jsonl", "--chain-id", start.chainId, ...args])).code).toBe(1);
    }
    for (const text of [JSON.stringify(large), "\n", "private-value\n"]) {
      await writeFile(join(directory, "bad.jsonl"), text);
      const result = await run(["bad.jsonl", "--chain-id", start.chainId]);
      expect(result).toEqual({ code: 1, stdout: "", stderr: "Audit chain verification failed.\n" });
    }
    await writeFile(join(directory, "bad.jsonl"), Buffer.from([255, 10]));
    expect((await run(["bad.jsonl", "--chain-id", start.chainId])).code).toBe(1);
  });
  it("rejects usage errors, missing paths/checkpoints and tail loss, and accepts an empty anchored log", async () => {
    for (const args of [
      [],
      ["x"],
      ["x", "--chain-id"],
      ["x", "--chain-id", "a", "--start", "b"],
      ["x", "--chain-id", "a", "--unknown", "x"],
      ["x", "--chain-id", "a", "--chain-id", "b"],
      ["x", "--chain-id", "a", "--max-bytes", "NaN"]
    ])
      expect((await run(args)).code).toBe(2);
    expect((await run(["--help"])).code).toBe(0);
    expect((await run(["missing", "--chain-id", start.chainId])).code).toBe(1);
    expect((await run([".", "--chain-id", start.chainId])).code).toBe(1);
    await writeFile(join(directory, "empty"), "");
    await writeFile(join(directory, "head.json"), JSON.stringify(start));
    expect(
      (await run(["empty", "--chain-id", start.chainId, "--expect-head", "head.json"])).code
    ).toBe(0);
    const first = record(),
      head = verifyAuditChainRecord(first, start);
    await writeFile(join(directory, "head.json"), JSON.stringify(head));
    expect(
      (await run(["empty", "--chain-id", start.chainId, "--expect-head", "head.json"])).code
    ).toBe(1);
    expect((await run(["empty", "--start", "missing"])).code).toBe(1);
  });
});
