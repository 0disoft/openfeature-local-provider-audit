import { EventEmitter } from "node:events";
import type { FSWatcher, Stats, WatchListener } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createSnapshotWatchHandle } from "../../src/flags/snapshot-file.js";

describe("snapshot watch handle", () => {
  it("rearms the macOS file watcher after target replacement", () => {
    const fake = createFakeWatchRuntime("darwin");
    const onChange = vi.fn();
    const onError = vi.fn();
    const handle = createSnapshotWatchHandle(createWatchOptions(onChange, onError), fake.runtime);

    expect(fake.records.map((record) => record.path)).toEqual(["/flags", "/flags/flags.json"]);

    fake.records[1]?.listener("change", "flags.json");
    fake.records[0]?.listener("rename", "flags.json");

    expect(fake.records.map((record) => record.path)).toEqual([
      "/flags",
      "/flags/flags.json",
      "/flags/flags.json"
    ]);
    expect(fake.records[1]?.watcher.closed).toBe(true);
    expect(fake.records[2]?.watcher.closed).toBe(false);
    fake.records[2]?.listener("change", "flags.json");
    expect(onChange).toHaveBeenCalledTimes(3);

    const nativeError = new Error("native watch failed");
    fake.records[2]?.watcher.emit("error", nativeError);
    expect(onError).toHaveBeenCalledWith(nativeError);

    handle.close();
    expect(fake.records[0]?.watcher.closed).toBe(true);
    expect(fake.records[2]?.watcher.closed).toBe(true);
    handle.close();

    fake.records[0]?.listener("rename", "flags.json");
    expect(fake.records).toHaveLength(3);
  });

  it("closes the macOS directory watcher when initial file watching fails", () => {
    const fake = createFakeWatchRuntime("darwin", 1);

    expect(() =>
      createSnapshotWatchHandle(createWatchOptions(vi.fn(), vi.fn()), fake.runtime)
    ).toThrow("synthetic rearm failure");
    expect(fake.records[0]?.watcher.closed).toBe(true);
  });

  it("keeps the previous macOS file watcher when rearming fails", () => {
    const fake = createFakeWatchRuntime("darwin", 2);
    const onChange = vi.fn();
    const onError = vi.fn();
    const handle = createSnapshotWatchHandle(createWatchOptions(onChange, onError), fake.runtime);

    fake.records[0]?.listener("rename", "flags.json");

    expect(onError).toHaveBeenCalledOnce();
    expect(fake.records[1]?.watcher.closed).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
    handle.close();
    expect(fake.records[1]?.watcher.closed).toBe(true);
  });

  it("filters unrelated Linux directory events and closes the watcher", () => {
    const fake = createFakeWatchRuntime("linux");
    const onChange = vi.fn();
    const handle = createSnapshotWatchHandle(createWatchOptions(onChange, vi.fn()), fake.runtime);

    fake.records[0]?.listener("change", "other.json");
    fake.records[0]?.listener("change", "flags.json");

    expect(onChange).toHaveBeenCalledOnce();
    handle.close();
    expect(fake.records[0]?.watcher.closed).toBe(true);
  });

  it("uses and releases path polling on Windows", () => {
    const fake = createFakeWatchRuntime("win32");
    const onChange = vi.fn();
    const handle = createSnapshotWatchHandle(createWatchOptions(onChange, vi.fn()), fake.runtime);

    expect(fake.watchFile).toHaveBeenCalledOnce();
    const listener = fake.watchFile.mock.calls[0]?.[2];
    listener?.({ mtimeMs: 1, size: 2 } as Stats, { mtimeMs: 1, size: 2 } as Stats);
    listener?.({ mtimeMs: 2, size: 2 } as Stats, { mtimeMs: 1, size: 2 } as Stats);
    expect(onChange).toHaveBeenCalledOnce();

    handle.close();
    expect(fake.unwatchFile).toHaveBeenCalledOnce();
  });
});

function createWatchOptions(onChange: () => void, onError: (error: unknown) => void) {
  return {
    path: "/flags/flags.json",
    target: {
      directory: "/flags",
      fileName: "flags.json",
      path: "/flags/flags.json"
    },
    persistent: false,
    debounceMs: 10,
    onChange,
    onError
  };
}

function createFakeWatchRuntime(platform: NodeJS.Platform, failAtRecord?: number) {
  const records: FakeWatchRecord[] = [];
  const watchFile = vi.fn(
    (
      _path: string,
      _options: { bigint: false; persistent: boolean; interval: number },
      _listener: (current: Stats, previous: Stats) => void
    ) => undefined
  );
  const unwatchFile = vi.fn(
    (_path: string, _listener: (current: Stats, previous: Stats) => void) => undefined
  );

  return {
    records,
    watchFile,
    unwatchFile,
    runtime: {
      platform,
      watch(path: string, _options: { persistent: boolean }, listener: WatchListener<string>) {
        if (records.length === failAtRecord) {
          throw new Error("synthetic rearm failure");
        }
        const watcher = new FakeFsWatcher();
        records.push({ path, listener, watcher });
        return watcher as unknown as FSWatcher;
      },
      watchFile,
      unwatchFile
    }
  };
}

interface FakeWatchRecord {
  readonly path: string;
  readonly listener: WatchListener<string>;
  readonly watcher: FakeFsWatcher;
}

class FakeFsWatcher extends EventEmitter {
  closed = false;

  close(): void {
    this.closed = true;
  }
}
