import { open, mkdtemp, writeFile, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readChainLines } from "../../src/audit/read-chain-lines.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let directory: string;
let cap: number;
let allocatedBytes: number;
let readBuffers: WeakSet<Buffer>;
let handles: FileHandle[];
let closes: number;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-short-lines-"));
  cap = 1;
  allocatedBytes = 0;
  readBuffers = new WeakSet();
  handles = [];
  closes = 0;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    handles.push(handle);
    return {
      stat: handle.stat.bind(handle),
      async read(
        buffer: Buffer,
        offset = 0,
        length = buffer.length - offset,
        position: number | null = null
      ) {
        if (!readBuffers.has(buffer)) {
          readBuffers.add(buffer);
          allocatedBytes += buffer.length;
        }
        return handle.read(buffer, offset, Math.min(length, cap), position);
      },
      async close() {
        closes++;
        await handle.close();
      }
    } as never;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(open).mockClear();
  await Promise.allSettled(
    handles.filter((handle) => handle.fd >= 0).map((handle) => handle.close())
  );
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-short-lines-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
async function collect(bytes: Buffer, maxRecordBytes: number, budget = 16 * 1024 * 1024) {
  const path = join(directory, "audit.jsonl");
  await writeFile(path, bytes);
  const lines: string[] = [];
  for await (const line of readChainLines(path, { remaining: budget }, maxRecordBytes))
    lines.push(line);
  return lines;
}
it("bounds retained buffers when 1 KiB of a record arrives one byte at a time", async () => {
  let retained = 0;
  let fragments = 0;
  const concat = Buffer.concat;
  vi.spyOn(Buffer, "concat").mockImplementation((parts, length) => {
    const backing = new Set(parts.map((part) => part.buffer));
    retained = Math.max(
      retained,
      [...backing].reduce((sum, buffer) => sum + buffer.byteLength, 0)
    );
    fragments = Math.max(fragments, parts.length);
    return concat(parts, length);
  });
  const line = "a".repeat(1024);
  expect(await collect(Buffer.from(`${line}\n`), 1024)).toEqual([line]);
  expect(closes).toBe(1);
  console.info(
    JSON.stringify({
      shortReadBytes: cap,
      recordBytes: 1024,
      retainedBackingBytes: retained,
      inputBufferBytes: allocatedBytes,
      fragments
    })
  );
  expect(retained).toBeLessThanOrEqual(64 * 1024);
  expect(allocatedBytes).toBeLessThanOrEqual(64 * 1024);
  expect(fragments).toBeLessThanOrEqual(2);
});
it.each([1, 7, 4093])(
  "preserves BOM, UTF-8, CRLF and line boundaries with %s-byte reads",
  async (size) => {
    cap = size;
    const line = size === 1 ? "가😀\r" : `${"a".repeat(65535)}가😀\r`;
    const data = Buffer.from(`\uFEFF${line}\n\uFEFFnext\nlast\n`);
    expect(await collect(data, Buffer.byteLength(line))).toEqual([line, "\uFEFFnext", "last"]);
    expect(closes).toBe(1);
    expect(allocatedBytes).toBeLessThanOrEqual(Math.ceil(data.length / 65536) * 65536);
  }
);
it("preserves strict EOF, record/total limits and close on short reads", async () => {
  for (const data of [
    Buffer.from("partial"),
    Buffer.from([0xe2, 10, 0x82, 0xac, 10]),
    Buffer.from("12345\n")
  ])
    await expect(collect(data, 4)).rejects.toThrow();
  expect(closes).toBe(3);
  await expect(collect(Buffer.from("valid\n"), 5, 5)).rejects.toThrow();
  expect(closes).toBe(4);
  expect(await collect(Buffer.from("\uFEFF"), 1)).toEqual([]);
  expect(closes).toBe(5);
});
it("closes after early consumer return without overwriting yielded data", async () => {
  const path = join(directory, "early.jsonl");
  await writeFile(path, "first\nsecond\n");
  const iterator = readChainLines(path, { remaining: 1024 * 1024 }, 100);
  expect(await iterator.next()).toEqual({ value: "first", done: false });
  await iterator.return(undefined);
  expect(closes).toBe(1);
});
it("reuses a full block after completed lines without changing yielded strings", async () => {
  cap = 65536;
  const first = "a".repeat(65535),
    second = "b".repeat(65535);
  expect(await collect(Buffer.from(`${first}\n${second}\n`), 65535)).toEqual([first, second]);
  expect(allocatedBytes).toBe(65536);
  expect(closes).toBe(1);
});
