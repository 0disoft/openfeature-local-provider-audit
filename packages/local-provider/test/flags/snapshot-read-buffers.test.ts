import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { readFileWithinLimit } from "../../src/flags/snapshot-file.js";

it.each([
  [1024 * 1024, []],
  [64 * 1024 + 17, [17]]
] as const)(
  "retains full read buffers and compacts short reads (%i bytes)",
  async (bytes, copies) => {
    const directory = await mkdtemp(join(tmpdir(), "snapshot-read-buffers-"));
    const input = Buffer.alloc(bytes);
    for (let offset = 0; offset < bytes; offset += 64 * 1024)
      input.fill(65 + offset / (64 * 1024), offset, Math.min(bytes, offset + 64 * 1024));
    const expected = input.toString("utf8");
    try {
      const path = join(directory, "snapshot.txt");
      await writeFile(path, input);
      const from = vi.spyOn(Buffer, "from");
      let actual: string;
      let copiedBytes: number[];
      try {
        actual = await readFileWithinLimit(path, bytes, "utf8");
        copiedBytes = from.mock.calls.flatMap(([value]) =>
          value instanceof Uint8Array ? [value.byteLength] : []
        );
      } finally {
        from.mockRestore();
      }
      expect(actual).toBe(expected);
      expect(copiedBytes).toEqual(copies);
    } finally {
      expect(resolve(directory).startsWith(join(resolve(tmpdir()), "snapshot-read-buffers-"))).toBe(
        true
      );
      await rm(directory, { recursive: true, force: true });
    }
  }
);
