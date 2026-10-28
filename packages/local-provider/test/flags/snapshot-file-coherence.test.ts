import {
  appendFile,
  mkdtemp,
  open,
  rename,
  rm,
  utimes,
  writeFile,
  type FileHandle
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createWatchedLocalProvider,
  loadFlagSnapshotFile,
  type FlagSnapshot
} from "../../src/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(open).mockReset().mockImplementation(actual.open);
});

function encoded(value: string) {
  const flag = (text: string) => ({ type: "string", variants: { on: text }, defaultVariant: "on" });
  return JSON.stringify({
    schemaVersion: 1,
    flags: { first: flag(value), padding: flag("x".repeat(70000)), last: flag(value) }
  });
}
function values(snapshot: FlagSnapshot) {
  return [snapshot.flags.first?.variants.on, snapshot.flags.last?.variants.on];
}
async function fixture(
  run: (state: {
    path: string;
    handles: FileHandle[];
    interleave: (work: (handle: FileHandle) => Promise<void>) => void;
  }) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-coherence-"));
  const path = join(directory, "flags.json");
  const handles: FileHandle[] = [];
  let interleave: ((handle: FileHandle) => Promise<void>) | undefined;
  try {
    await writeFile(path, encoded("old"));
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      handles.push(handle);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "stat");
      vi.spyOn(handle, "close");
      vi.spyOn(handle, "read").mockImplementation((async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null
      ) => {
        const result = await read(buffer, offset, length, position);
        if (result.bytesRead > 0 && interleave !== undefined) {
          const work = interleave;
          interleave = undefined;
          await work(handle);
        }
        return result;
      }) as FileHandle["read"]);
      return handle;
    });
    await run({
      path,
      handles,
      interleave: (work) => {
        interleave = work;
      }
    });
  } finally {
    vi.restoreAllMocks();
    for (const handle of handles) if (handle.fd >= 0) await handle.close();
    expect(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}snapshot-coherence-`)).toBe(
      true
    );
    await rm(directory, { recursive: true, force: true });
  }
}

it("rejects a valid-JSON mixture of two same-size versions and closes the handle", async () => {
  await fixture(async ({ path, handles, interleave }) => {
    interleave(async () => {
      await writeFile(path, encoded("new"));
      await utimes(path, new Date(), new Date(Date.now() + 1000));
    });
    await expect(loadFlagSnapshotFile(path)).rejects.toMatchObject({ code: "PARSE_ERROR" });
    expect(handles[0]?.close).toHaveBeenCalledOnce();
    expect(values(await loadFlagSnapshotFile(path))).toEqual(["new", "new"]);
  });
});

it("rejects observed growth even when the appended bytes are valid JSON whitespace", async () => {
  await fixture(async ({ path, interleave }) => {
    interleave(() => appendFile(path, " "));
    await expect(loadFlagSnapshotFile(path)).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });
});

it("accepts stable files with one final handle metadata check", async () => {
  await fixture(async ({ path, handles }) => {
    expect(values(await loadFlagSnapshotFile(path))).toEqual(["old", "old"]);
    expect(handles[0]?.stat).toHaveBeenCalledTimes(2);
    expect(handles[0]?.close).toHaveBeenCalledOnce();
  });
});

it.each(["mtimeNs", "ctimeNs"] as const)(
  "rejects a one-nanosecond %s change without millisecond rounding",
  async (field) => {
    await fixture(async ({ path, interleave }) => {
      const changed = await actual.stat(path, { bigint: true });
      changed[field] += 1n;
      interleave(async (handle) => {
        vi.mocked(handle.stat).mockResolvedValueOnce(changed);
      });
      await expect(loadFlagSnapshotFile(path)).rejects.toMatchObject({ code: "PARSE_ERROR" });
    });
  }
);

it("propagates a failed final metadata read and still closes the file", async () => {
  await fixture(async ({ path, handles, interleave }) => {
    const failure = new Error("final metadata unavailable");
    interleave(async (handle) => {
      vi.mocked(handle.stat).mockRejectedValueOnce(failure);
    });
    await expect(loadFlagSnapshotFile(path)).rejects.toBe(failure);
    expect(handles[0]?.close).toHaveBeenCalledOnce();
  });
});

it.skipIf(process.platform === "win32")(
  "accepts the complete old inode during atomic path replacement, then reads the new version",
  async () => {
    await fixture(async ({ path, interleave }) => {
      interleave(async () => {
        const replacement = `${path}.next`;
        await writeFile(replacement, encoded("new"));
        await rename(replacement, path);
      });
      expect(values(await loadFlagSnapshotFile(path))).toEqual(["old", "old"]);
      expect(values(await loadFlagSnapshotFile(path))).toEqual(["new", "new"]);
    });
  }
);

it("keeps the last-good watched provider snapshot and allows an explicit stable retry", async () => {
  await fixture(async ({ path, interleave }) => {
    const watched = await createWatchedLocalProvider({ path, debounceMs: 60000 });
    const before = watched.getStatus().snapshotHash;
    try {
      interleave(async () => {
        await writeFile(path, encoded("new"));
        await utimes(path, new Date(), new Date(Date.now() + 1000));
      });
      await expect(watched.reload()).rejects.toMatchObject({ code: "PARSE_ERROR" });
      expect(watched.getStatus().snapshotHash).toBe(before);
      expect(values(watched.provider.getSnapshot())).toEqual(["old", "old"]);
      await watched.reload();
      expect(values(watched.provider.getSnapshot())).toEqual(["new", "new"]);
    } finally {
      await watched.close();
    }
  });
});
