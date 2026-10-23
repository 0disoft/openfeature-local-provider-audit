import { constants, unwatchFile } from "node:fs";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadFlagSnapshotFile, watchFlagSnapshotFile } from "../../src/flags/snapshot-file.js";

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    unwatchFile: vi.fn(actual.unwatchFile),
    constants: { ...actual.constants, O_NONBLOCK: actual.constants.O_NONBLOCK ?? 2048 }
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
afterEach(() => vi.restoreAllMocks());

it.skipIf(process.platform !== "win32")(
  "preserves initial callback and real polling cleanup failures",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "snapshot-startup-cleanup-"));
    const native = await vi.importActual<typeof import("node:fs")>("node:fs");
    const primary = new Error("initial delivery failed");
    const cleanup = new Error("poll cleanup failed");
    try {
      const path = join(directory, "flags.json");
      await writeFile(path, '{"schemaVersion":1,"flags":{}}');
      vi.mocked(unwatchFile)
        .mockClear()
        .mockImplementationOnce((...args) => {
          native.unwatchFile(...args);
          throw cleanup;
        });
      const error = await watchFlagSnapshotFile({
        path,
        onSnapshot() {
          throw primary;
        }
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([primary, cleanup]);
      expect((error as AggregateError).cause).toBe(primary);
      expect(unwatchFile).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

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

it.each(["stat", "read"] as const)(
  "retains both the %s failure and a close failure, closing once",
  async (stage) => {
    await withSnapshotHandle(async (path, handle, release) => {
      const primary = new Error(`injected ${stage} failure`);
      const cleanup = new Error("injected close failure");
      if (stage === "stat") vi.spyOn(handle, "stat").mockRejectedValueOnce(primary);
      else vi.spyOn(handle, "read").mockRejectedValueOnce(primary);
      vi.mocked(handle.close).mockImplementationOnce(async () => {
        await release();
        throw cleanup;
      });
      const error = await loadFlagSnapshotFile(path).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([primary, cleanup]);
      expect((error as AggregateError).cause).toBe(primary);
      expect(handle.close).toHaveBeenCalledOnce();
    });
  }
);

it("preserves the original read failure when closing succeeds", async () => {
  await withSnapshotHandle(async (path, handle) => {
    const primary = new Error("injected read failure");
    vi.spyOn(handle, "read").mockRejectedValueOnce(primary);
    await expect(loadFlagSnapshotFile(path)).rejects.toBe(primary);
    expect(handle.close).toHaveBeenCalledOnce();
  });
});

it("reports a lone close failure after a successful read without retrying", async () => {
  await withSnapshotHandle(async (path, handle, release) => {
    const cleanup = new Error("injected close failure");
    vi.mocked(handle.close).mockImplementationOnce(async () => {
      await release();
      throw cleanup;
    });
    await expect(loadFlagSnapshotFile(path)).rejects.toBe(cleanup);
    expect(handle.close).toHaveBeenCalledOnce();
  });
});

async function withSnapshotHandle(
  run: (path: string, handle: FileHandle, release: () => Promise<void>) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-read-cleanup-"));
  const native = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const path = join(directory, "flags.json");
  await writeFile(path, '{"schemaVersion":1,"flags":{}}');
  const handle = await native.open(path, "r");
  const nativeClose = handle.close.bind(handle);
  let released = false;
  const release = async () => {
    await nativeClose();
    released = true;
  };
  vi.spyOn(handle, "close").mockImplementation(release);
  vi.mocked(open).mockResolvedValueOnce(handle);
  try {
    await run(path, handle, release);
  } finally {
    if (!released) await release();
    await rm(directory, { recursive: true, force: true });
  }
}
