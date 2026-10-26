import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseJsonFlagSnapshot } from "../../src/flags/parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "../../src/flags/parse-yaml-snapshot.js";
import { watchFlagSnapshotFile } from "../../src/flags/snapshot-file.js";

const activity = vi.hoisted(() => ({ notify: () => {}, reads: 0 }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn((_path, _options, listener) => {
      activity.notify = () => listener("change", "flags.json");
      return {
        on() {
          return this;
        },
        close() {}
      };
    }),
    watchFile: vi.fn((_path, _options, listener) => {
      let tick = 0;
      activity.notify = () => listener({ mtimeMs: ++tick }, { mtimeMs: tick - 1 });
    }),
    unwatchFile: vi.fn()
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        activity.reads++;
      };
      return handle;
    })
  };
});
vi.mock("../../src/flags/parse-json-snapshot.js", async (original) => {
  const actual = await original<typeof import("../../src/flags/parse-json-snapshot.js")>();
  return { ...actual, parseJsonFlagSnapshot: vi.fn(actual.parseJsonFlagSnapshot) };
});
vi.mock("../../src/flags/parse-yaml-snapshot.js", async (original) => {
  const actual = await original<typeof import("../../src/flags/parse-yaml-snapshot.js")>();
  return { ...actual, parseYamlFlagSnapshot: vi.fn(actual.parseYamlFlagSnapshot) };
});
afterEach(() => vi.clearAllMocks());

function snapshot(value = "initial"): string {
  return JSON.stringify({
    schemaVersion: 1,
    flags: {
      message: { type: "string", defaultVariant: "on", variants: { on: value } }
    }
  });
}

async function notify(): Promise<void> {
  const completed = activity.reads + 1;
  activity.notify();
  await vi.waitFor(() => expect(activity.reads).toBe(completed));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

it.each(["json", "yaml"] as const)(
  "skips accepted identical %s input only on automatic reload",
  async (format) => {
    const directory = await mkdtemp(join(tmpdir(), "snapshot-dedup-"));
    let watcher: Awaited<ReturnType<typeof watchFlagSnapshotFile>> | undefined;
    const parser = format === "json" ? parseJsonFlagSnapshot : parseYamlFlagSnapshot;
    const onSnapshot = vi.fn();
    try {
      const path = join(directory, "flags.json");
      const text = snapshot(); // JSON is valid YAML, too.
      await writeFile(path, text);
      watcher = await watchFlagSnapshotFile({ path, format, debounceMs: 0, onSnapshot });
      const accepted = watcher.getSnapshot();
      await notify();
      await notify();
      expect(parser).toHaveBeenCalledOnce();
      expect(onSnapshot).toHaveBeenCalledOnce();
      expect(watcher.getSnapshot()).toBe(accepted);
      await writeFile(path, `\n${text}\n`);
      await notify();
      await notify();
      expect(parser).toHaveBeenCalledTimes(2);
      expect(onSnapshot).toHaveBeenCalledOnce();
      expect(watcher.getSnapshot()).toBe(accepted);
      await watcher.reload();
      expect(parser).toHaveBeenCalledTimes(3);
      expect(onSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      watcher?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it("never memoizes parse failures or rejected deliveries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-dedup-failure-"));
  let watcher: Awaited<ReturnType<typeof watchFlagSnapshotFile>> | undefined;
  const onSnapshot = vi.fn();
  const onError = vi.fn();
  try {
    const path = join(directory, "flags.json");
    await writeFile(path, snapshot());
    watcher = await watchFlagSnapshotFile({ path, debounceMs: 0, onSnapshot, onError });
    const accepted = watcher.getSnapshot();
    await writeFile(path, "{");
    await notify();
    await notify();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(watcher.getSnapshot()).toBe(accepted);
    await writeFile(path, snapshot("next"));
    onSnapshot.mockRejectedValueOnce(new Error("consumer rejected"));
    await notify();
    expect(watcher.getSnapshot()).toBe(accepted);
    await notify();
    expect(watcher.getSnapshot()?.flags.message?.variants.on).toBe("next");
    expect(parseJsonFlagSnapshot).toHaveBeenCalledTimes(5);
    expect(onSnapshot).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
    await notify();
    expect(parseJsonFlagSnapshot).toHaveBeenCalledTimes(5);
  } finally {
    watcher?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("distinguishes lone UTF-16 surrogates with explicit legacy decoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-dedup-utf16-"));
  let watcher: Awaited<ReturnType<typeof watchFlagSnapshotFile>> | undefined;
  const onSnapshot = vi.fn();
  try {
    const path = join(directory, "flags.json");
    const text = (value: string) => snapshot("MARKER").replace("MARKER", value);
    await writeFile(path, text("\ud800"), "utf16le");
    watcher = await watchFlagSnapshotFile({ path, encoding: "utf16le", debounceMs: 0, onSnapshot });
    await writeFile(path, text("\ud801"), "utf16le");
    await notify();
    expect(watcher.getSnapshot()?.flags.message?.variants.on).toBe("\ud801");
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    await notify();
    expect(parseJsonFlagSnapshot).toHaveBeenCalledTimes(2);
  } finally {
    watcher?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
