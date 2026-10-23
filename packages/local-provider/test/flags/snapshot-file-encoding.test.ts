import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadFlagSnapshotFile, watchFlagSnapshotFile } from "../../src/index.js";

function snapshot(value: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    flags: { message: { type: "string", defaultVariant: "on", variants: { on: value } } }
  });
}

function malformedSnapshot(hex: string): Buffer {
  const [before, after] = snapshot("MARKER").split("MARKER");
  return Buffer.concat([
    Buffer.from(before ?? ""),
    Buffer.from(hex, "hex"),
    Buffer.from(after ?? "")
  ]);
}

it.each(["json", "yaml"] as const)(
  "rejects malformed UTF-8 in %s before applying replacement text",
  async (format) => {
    const directory = await mkdtemp(join(tmpdir(), "snapshot-encoding-"));
    try {
      const path = join(directory, `flags.${format}`);
      // JSON is also YAML: exercise both parsers with exactly the same damaged bytes.
      for (const hex of ["c3", "c328", "80", "eda080", "f4908080"]) {
        await writeFile(path, malformedSnapshot(hex));
        for (const encoding of ["utf8", "utf-8"] as const) {
          await expect(loadFlagSnapshotFile(path, { encoding })).rejects.toMatchObject({
            code: "PARSE_ERROR",
            message: "Flag snapshot file must contain valid UTF-8."
          });
        }
      }
      const damaged = malformedSnapshot("80");
      await writeFile(path, damaged);
      await expect(loadFlagSnapshotFile(path, { maxBytes: damaged.length - 1 })).rejects.toThrow(
        "exceeds maxBytes"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it("preserves valid Unicode across read boundaries and an explicit legacy encoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-unicode-"));
  try {
    const path = join(directory, "flags.json");
    const prefixLength = Buffer.byteLength(snapshot("MARKER").split("MARKER")[0] ?? "");
    const value = `${"a".repeat(65_535 - prefixLength)}한😀�`;
    const bytes = Buffer.from(snapshot(value));
    await writeFile(path, bytes);
    expect(
      (await loadFlagSnapshotFile(path, { maxBytes: bytes.length })).flags.message?.variants.on
    ).toBe(value);
    await writeFile(path, snapshot("é"), "latin1");
    expect(
      (await loadFlagSnapshotFile(path, { encoding: "latin1" })).flags.message?.variants.on
    ).toBe("é");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("retains the last valid watcher snapshot after malformed UTF-8 and recovers on the next reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-encoding-reload-"));
  let watcher: Awaited<ReturnType<typeof watchFlagSnapshotFile>> | undefined;
  const onSnapshot = vi.fn();
  try {
    const path = join(directory, "flags.json");
    await writeFile(path, snapshot("initial"));
    watcher = await watchFlagSnapshotFile({ path, debounceMs: 60_000, onSnapshot });
    const initial = watcher.getSnapshot();
    await writeFile(path, malformedSnapshot("c328"));
    await expect(watcher.reload()).rejects.toMatchObject({ code: "PARSE_ERROR" });
    expect(watcher.getSnapshot()).toBe(initial);
    expect(onSnapshot).toHaveBeenCalledOnce();
    await writeFile(path, snapshot("recovered"));
    await watcher.reload();
    expect(watcher.getSnapshot()?.flags.message?.variants.on).toBe("recovered");
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  } finally {
    watcher?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
