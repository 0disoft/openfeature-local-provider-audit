import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
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
  return { ...actual, open: vi.fn(actual.open) };
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
