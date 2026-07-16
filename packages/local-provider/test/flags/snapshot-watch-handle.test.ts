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

  it("documents the Linux projected-volume event gap", () => {
    const fake = createFakeWatchRuntime("linux");
    const onChange = vi.fn();
    const handle = createSnapshotWatchHandle(createWatchOptions(onChange, vi.fn()), fake.runtime);

    fake.records[0]?.listener("rename", "..data");
    expect(onChange).not.toHaveBeenCalled();

    fake.records[0]?.listener("rename", "flags.json");
    expect(onChange).toHaveBeenCalledOnce();
    handle.close();
  });

  it("adds and releases identity-aware consistency polling on Linux", () => {
    const fake = createFakeWatchRuntime("linux");
    const onChange = vi.fn();
    const handle = createSnapshotWatchHandle(
      createWatchOptions(onChange, vi.fn(), { consistencyPollIntervalMs: 50 }),
      fake.runtime
    );

    expect(fake.records).toHaveLength(1);
    expect(fake.watchFile).toHaveBeenCalledOnce();
    expect(fake.watchFile.mock.calls[0]?.[1]).toMatchObject({
      interval: 50,
      persistent: false
    });

    const listener = fake.watchFile.mock.calls[0]?.[2];
    const initial = createStats({ dev: 1, ino: 10, mtimeMs: 1, ctimeMs: 1, size: 20 });
    const replacement = createStats({ dev: 1, ino: 11, mtimeMs: 1, ctimeMs: 1, size: 20 });
    listener?.(initial, initial);
    listener?.(replacement, initial);
    expect(onChange).toHaveBeenCalledOnce();

    handle.close();
    handle.close();
    expect(fake.unwatchFile).toHaveBeenCalledOnce();
    expect(fake.records[0]?.watcher.closed).toBe(true);

    listener?.(createStats({ ...replacement, ino: 12 }), replacement);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("closes the native watcher when consistency polling setup fails", () => {
    const fake = createFakeWatchRuntime("linux");
    fake.watchFile.mockImplementationOnce(() => {
      throw new Error("synthetic polling failure");
    });

    expect(() =>
      createSnapshotWatchHandle(
        createWatchOptions(vi.fn(), vi.fn(), { consistencyPollIntervalMs: 50 }),
        fake.runtime
      )
    ).toThrow("synthetic polling failure");
    expect(fake.records[0]?.watcher.closed).toBe(true);
  });

  it("rejects consistency polling below the resource floor", () => {
    const fake = createFakeWatchRuntime("linux");

    expect(() =>
      createSnapshotWatchHandle(
        createWatchOptions(vi.fn(), vi.fn(), { consistencyPollIntervalMs: 49 }),
        fake.runtime
      )
    ).toThrow("consistencyPollIntervalMs must be an integer greater than or equal to 50");
    expect(fake.records).toHaveLength(0);
    expect(fake.watchFile).not.toHaveBeenCalled();
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

function createWatchOptions(
  onChange: () => void,
  onError: (error: unknown) => void,
  overrides: { readonly consistencyPollIntervalMs?: number } = {}
) {
  return {
    path: "/flags/flags.json",
    target: {
      directory: "/flags",
      fileName: "flags.json",
      path: "/flags/flags.json"
    },
    persistent: false,
    debounceMs: 10,
    ...overrides,
    onChange,
    onError
  };
}

function createStats(values: Pick<Stats, "dev" | "ino" | "mtimeMs" | "ctimeMs" | "size">): Stats {
  return values as Stats;
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
