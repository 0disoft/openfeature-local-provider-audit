import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { readChainLines } from "../../src/audit/read-chain-lines.js";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-chain-lines-"));
});
afterEach(async () => {
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-chain-lines-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
async function read(bytes: Buffer, maxRecordBytes: number, budget = bytes.length) {
  const path = join(directory, "records.jsonl");
  await writeFile(path, bytes);
  const lines: string[] = [];
  for await (const line of readChainLines(path, { remaining: budget }, maxRecordBytes))
    lines.push(line);
  return lines;
}
it.each([65535, 65536, 65537])(
  "preserves exact-byte lines across the 64 KiB boundary: %s",
  async (size) => {
    const line = "a".repeat(size);
    await expect(read(Buffer.from(`${line}\nshort\n`), size)).resolves.toEqual([line, "short"]);
    await expect(read(Buffer.from(`${line}\n`), size - 1)).rejects.toThrow();
  }
);
it("preserves multi-byte UTF-8 across fragments, CRLF and file-level BOM semantics", async () => {
  const first = `${"a".repeat(65535)}가雪\r`;
  const bytes = Buffer.from(`\uFEFF${first}\n\uFEFFnext\n`);
  await expect(read(bytes, Buffer.byteLength(first))).resolves.toEqual([first, "\uFEFFnext"]);
  await expect(read(Buffer.from("\uFEFF가\n"), 3)).resolves.toEqual(["가"]);
});
it("rejects malformed/partial lines and byte overflow while accepting an empty file", async () => {
  await expect(read(Buffer.alloc(0), 10)).resolves.toEqual([]);
  await expect(read(Buffer.from("\uFEFF"), 1)).resolves.toEqual([]);
  for (const bytes of [
    Buffer.from("\n"),
    Buffer.from("valid\npartial"),
    Buffer.from([0xe2, 10, 0x82, 0xac, 10]),
    Buffer.from([0xff, 10])
  ])
    await expect(read(bytes, 100)).rejects.toThrow();
  const bytes = Buffer.from("valid\n");
  await expect(read(bytes, 5, bytes.length - 1)).rejects.toThrow();
});
