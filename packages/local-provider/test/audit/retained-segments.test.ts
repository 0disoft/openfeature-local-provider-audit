import {
  appendFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openChainFile } from "../../src/audit/chain-files.js";
import { createChainedFileAuditSink, createAuditEvent, evaluateFlag } from "../../src/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});
vi.mock("../../src/audit/chain-files.js", async (original) => {
  const actual = await original<typeof import("../../src/audit/chain-files.js")>();
  return { ...actual, openChainFile: vi.fn(actual.openChainFile) };
});

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-sealed-segments-"));
});
afterEach(async () => {
  vi.clearAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-sealed-segments-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

function event() {
  const snapshot = { schemaVersion: 1 as const, flags: {} };
  const request = { flagKey: "f", expectedType: "boolean" as const, defaultValue: false };
  return createAuditEvent({
    snapshot,
    request,
    result: evaluateFlag(snapshot, request),
    providerName: "test"
  });
}
async function populated() {
  const sink = createChainedFileAuditSink({
    directory,
    chainId: "retained/test",
    maxSegmentBytes: 1,
    maxSegments: 6
  });
  for (let index = 0; index < 5; index++) await sink.write(event());
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as {
    segments: { file: string }[];
  };
  return { sink, sealed: manifest.segments.slice(0, -1).map(({ file }) => join(directory, file)) };
}

it("checks sealed segments without opening descriptors during append", async () => {
  const { sink, sealed } = await populated();
  expect(sealed).toHaveLength(4);
  vi.mocked(openChainFile).mockClear();
  vi.mocked(lstat).mockClear();
  await sink.write(event());
  const reopened = vi.mocked(openChainFile).mock.calls.filter(([path]) => sealed.includes(path));
  expect(reopened).toHaveLength(0);
  for (const path of sealed) {
    expect(vi.mocked(lstat).mock.calls.filter(([input]) => input === path)).toHaveLength(1);
  }
  // Full checkpoint verification still reads all retained history.
  expect((await sink.getCheckpoint()).head.sequence).toBe(6);
});

it.each(["missing", "truncated", "extended", "directory", "hardlink"])(
  "rejects a %s sealed segment before appending another record",
  async (mutation) => {
    const { sink, sealed } = await populated();
    const path = sealed[0];
    if (path === undefined) throw new Error("Missing fixture");
    if (mutation === "missing") await unlink(path);
    else if (mutation === "truncated") await writeFile(path, "");
    else if (mutation === "extended") await appendFile(path, "\n");
    else if (mutation === "directory") {
      await unlink(path);
      await mkdir(path);
    } else await link(path, join(directory, "alias"));
    const before = await readFile(join(directory, "manifest.json"), "utf8");
    await expect(sink.write(event())).rejects.toThrow("Chained audit storage is unavailable");
    expect(await readFile(join(directory, "manifest.json"), "utf8")).toBe(before);
  }
);
