import type { FileHandle } from "node:fs/promises";
import { expect, it } from "vitest";
import { readChainTail } from "../../src/audit/chain-files.js";

function reader(bytes: Buffer, cap = Number.MAX_SAFE_INTEGER) {
  const ranges: { start: number; end: number }[] = [];
  const handle = {
    async read(buffer: Buffer, offset: number, length: number, position: number) {
      const bytesRead = Math.min(length, cap, bytes.length - position);
      bytes.copy(buffer, offset, position, position + bytesRead);
      ranges.push({ start: position, end: position + bytesRead });
      return { bytesRead, buffer };
    }
  } as unknown as FileHandle;
  return { handle, ranges };
}

it.each([4095, 4096, 4097, 8191, 8192, 8193, 65535, 65536, 65537])(
  "reads each expanded tail byte once for a %s-byte final line",
  async (length) => {
    const line = Buffer.from(`${"x".repeat(length - 1)}\n`);
    const bytes = Buffer.concat([Buffer.from("previous\n"), line]);
    const { handle, ranges } = reader(bytes);
    expect(await readChainTail(handle, bytes.length, length - 1)).toEqual(line);
    const ordered = [...ranges].sort((a, b) => a.start - b.start);
    for (let index = 1; index < ordered.length; index++)
      expect(ordered[index]?.start).toBe(ordered[index - 1]?.end);
    expect(ranges.reduce((sum, range) => sum + range.end - range.start, 0)).toBe(length);
  }
);

it("assembles short reads in byte order and excludes an uncommitted suffix", async () => {
  const line = Buffer.from(`${"가😀".repeat(1600)}\r\n`);
  const committed = Buffer.concat([Buffer.from("old\n"), line]);
  const { handle, ranges } = reader(Buffer.concat([committed, Buffer.from("pending\n")]), 997);
  expect(await readChainTail(handle, committed.length, line.length - 1)).toEqual(line);
  expect(ranges.reduce((sum, range) => sum + range.end - range.start, 0)).toBe(line.length);
});

it.each([4096, 8192])("finds a separator in a one-byte prefix before %s bytes", async (length) => {
  const line = Buffer.from(`${"x".repeat(length - 1)}\n`);
  const bytes = Buffer.concat([Buffer.from("\n"), line]);
  const { handle, ranges } = reader(bytes);
  expect(await readChainTail(handle, bytes.length, length + 100)).toEqual(line);
  expect(ranges.at(-1)).toEqual({ start: 0, end: 1 });
  expect(ranges.reduce((sum, range) => sum + range.end - range.start, 0)).toBe(bytes.length);
});

it("retains the bounded suffix when no separator exists inside the byte cap", async () => {
  const bytes = Buffer.from(`${"x".repeat(20000)}\n`);
  const { handle, ranges } = reader(bytes);
  expect(await readChainTail(handle, bytes.length, 8192)).toEqual(bytes.subarray(-8193));
  expect(ranges.reduce((sum, range) => sum + range.end - range.start, 0)).toBe(8193);
});

it.each([Buffer.alloc(0), Buffer.from("partial"), Buffer.from("x".repeat(9000))])(
  "rejects a missing terminal LF",
  async (bytes) => {
    const { handle } = reader(bytes);
    await expect(readChainTail(handle, bytes.length, 10000)).rejects.toThrow();
  }
);

it("rejects early EOF without returning partially initialized bytes", async () => {
  const { handle } = reader(Buffer.from("x\n"));
  await expect(readChainTail(handle, 5, 100)).rejects.toThrow();
});
