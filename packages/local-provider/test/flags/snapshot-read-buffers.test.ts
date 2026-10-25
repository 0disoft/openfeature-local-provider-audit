import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readFileWithinLimit } from "../../src/flags/snapshot-file.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(open).mockReset().mockImplementation(actual.open);
});

it.each([
  [1024 * 1024, []],
  [64 * 1024 + 17, []]
] as const)(
  "preserves multi-block contents without per-read copies (%i bytes)",
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

async function withReadMetrics(
  input: Buffer,
  options: { cap?: number; reportedSize?: number },
  check: (
    read: (maxBytes?: number) => Promise<string>,
    metrics: { allocated: number; concatenated: number; closes: number; reads: number }
  ) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-read-budget-"));
  const path = join(directory, "snapshot.txt");
  const handles: Awaited<ReturnType<typeof actual.open>>[] = [];
  const seen = new WeakSet<Buffer>();
  const metrics = { allocated: 0, concatenated: 0, closes: 0, reads: 0 };
  try {
    await writeFile(path, input);
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      handles.push(handle);
      return {
        async stat() {
          const stats = await handle.stat();
          if (options.reportedSize !== undefined) stats.size = options.reportedSize;
          return stats;
        },
        async read(buffer: Buffer, offset: number, length: number, position: number | null) {
          if (!seen.has(buffer)) {
            seen.add(buffer);
            metrics.allocated += buffer.length;
          }
          metrics.reads++;
          return handle.read(buffer, offset, Math.min(length, options.cap ?? 65536), position);
        },
        async close() {
          metrics.closes++;
          await handle.close();
        }
      } as never;
    });
    const concat = Buffer.concat;
    vi.spyOn(Buffer, "concat").mockImplementation((parts, length) => {
      metrics.concatenated += length ?? parts.reduce((total, part) => total + part.byteLength, 0);
      return concat(parts, length);
    });
    await check(
      (maxBytes = 10 * 1024 * 1024) => readFileWithinLimit(path, maxBytes, "utf8"),
      metrics
    );
  } finally {
    vi.restoreAllMocks();
    for (const handle of handles) if (handle.fd >= 0) await handle.close();
    expect(resolve(directory).startsWith(join(resolve(tmpdir()), "snapshot-read-budget-"))).toBe(
      true
    );
    await rm(directory, { recursive: true, force: true });
  }
}
it.each([65536, 1, 7])("bounds allocation for a 1 KiB file with %i-byte reads", async (cap) => {
  const input = Buffer.alloc(1024, 97);
  await withReadMetrics(input, { cap }, async (read, metrics) => {
    expect(await read()).toBe(input.toString("utf8"));
    console.info(JSON.stringify({ bytes: input.length, cap, ...metrics }));
    expect(metrics.allocated).toBe(input.length + 1);
    expect(metrics.concatenated).toBe(0);
    expect(metrics.reads).toBe(Math.ceil(input.length / cap) + 1);
    expect(metrics.closes).toBe(1);
  });
});
it("grows from stale zero size and keeps the exact byte limit", async () => {
  const input = Buffer.from("가雪".repeat(200));
  await withReadMetrics(input, { cap: 7, reportedSize: 0 }, async (read, metrics) => {
    expect(await read(input.length)).toBe(input.toString("utf8"));
    expect(metrics.allocated).toBeLessThan(4 * (input.length + 1));
    await expect(read(input.length - 1)).rejects.toMatchObject({ code: "PARSE_ERROR" });
    expect(metrics.closes).toBe(2);
  });
});
it("decodes only initialized bytes after shrinkage and rejects malformed UTF-8", async () => {
  const input = Buffer.from("가雪");
  await withReadMetrics(input, { reportedSize: 1024 }, async (read, metrics) => {
    expect(await read()).toBe(input.toString("utf8"));
    expect(metrics.closes).toBe(1);
  });
  await withReadMetrics(Buffer.from([0xc3]), { cap: 1, reportedSize: 0 }, async (read, metrics) => {
    await expect(read()).rejects.toMatchObject({ code: "PARSE_ERROR" });
    expect(metrics.closes).toBe(1);
  });
});
