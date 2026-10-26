import { constants } from "node:fs";
import { lstat, mkdtemp, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createFileAuditSink } from "../../src/audit/audit-sink.js";
import { createAuditEvent } from "../../src/audit/audit-event.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    constants: { ...actual.constants, O_NONBLOCK: actual.constants.O_NONBLOCK ?? 2048 }
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open) };
});
afterEach(() => vi.restoreAllMocks());

function event() {
  const snapshot = { schemaVersion: 1 as const, flags: {} };
  const request = { flagKey: "f", expectedType: "boolean" as const, defaultValue: false };
  return createAuditEvent({
    snapshot,
    request,
    result: evaluateFlag(snapshot, request),
    providerName: "safety"
  });
}

it.each([
  { label: "batched append", options: {}, writes: 64, checks: 1 },
  { label: "locked append", options: { lock: true }, writes: 1, checks: 1 },
  { label: "rotation-enabled append", options: { maxBytes: 1_000_000 }, writes: 1, checks: 2 }
])(
  "keeps required path checks for $label and writes every record",
  async ({ options, writes, checks }) => {
    const directory = await mkdtemp(join(tmpdir(), "openfeature-path-check-"));
    try {
      const path = join(directory, "audit.jsonl");
      await writeFile(path, "");
      const record = event();
      const sink = createFileAuditSink({ path, createDirectory: false, ...options });
      vi.mocked(lstat).mockClear();
      await Promise.all(Array.from({ length: writes }, () => sink.write(record)));
      await sink.flush?.();
      expect(vi.mocked(lstat).mock.calls.filter(([input]) => input === path)).toHaveLength(checks);
      const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
      expect(lines.map((line) => JSON.parse(line))).toEqual(
        Array(writes).fill(JSON.parse(JSON.stringify(record)))
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it("rejects existing non-regular paths before open or rotation and drains the failed write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-file-type-"));
  try {
    vi.mocked(open).mockClear();
    for (const extra of [{}, { maxBytes: 1, maxFiles: 0 }]) {
      const sink = createFileAuditSink({ path: directory, createDirectory: false, ...extra });
      await expect(sink.write(event())).rejects.toThrow("must be a regular file");
      await expect(sink.flush?.()).rejects.toThrow("must be a regular file");
      await expect(sink.flush?.()).resolves.toBeUndefined();
      expect(sink.getStats?.().pendingWrites).toBe(0);
    }
    expect(open).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("opens nonblocking and closes a replacement non-regular handle without appending", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-file-race-"));
  try {
    const path = join(directory, "audit.jsonl");
    await writeFile(path, "");
    const close = vi.fn(async () => {});
    const appendFile = vi.fn();
    vi.mocked(open)
      .mockClear()
      .mockResolvedValueOnce({
        stat: async () => ({ isFile: () => false }),
        close,
        appendFile
      } as unknown as FileHandle);
    const sink = createFileAuditSink({ path, createDirectory: false });
    await expect(sink.write(event())).rejects.toThrow("must be a regular file");
    const flags = vi.mocked(open).mock.calls[0]?.[1] as number;
    expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(appendFile).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    await expect(sink.flush?.()).rejects.toThrow("must be a regular file");
    await sink.write(event());
    await expect(sink.flush?.()).resolves.toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
