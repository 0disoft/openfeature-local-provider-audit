import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadFlagSnapshotFile } from "../../src/flags/snapshot-file.js";

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

it("rejects non-regular snapshot paths before opening them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-snapshot-type-"));
  try {
    vi.mocked(open).mockClear();
    await expect(loadFlagSnapshotFile(directory, { format: "json" })).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: "Flag snapshot path must resolve to a regular file."
    });
    expect(open).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("opens nonblocking and rejects a replacement special file before reading, closing its handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-snapshot-race-"));
  try {
    const path = join(directory, "flags.json");
    await writeFile(path, "{}");
    const close = vi.fn(async () => {});
    const read = vi.fn();
    vi.mocked(open)
      .mockClear()
      .mockResolvedValueOnce({
        stat: async () => ({ isFile: () => false, size: 0 }),
        close,
        read
      } as unknown as FileHandle);
    await expect(loadFlagSnapshotFile(path)).rejects.toMatchObject({ code: "PARSE_ERROR" });
    const flags = vi.mocked(open).mock.calls[0]?.[1] as number;
    expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
