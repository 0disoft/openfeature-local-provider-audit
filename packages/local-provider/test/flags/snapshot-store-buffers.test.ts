import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFileSnapshotStore, signFlagSnapshot } from "../../src/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const keys = generateKeyPairSync("ed25519");
const verification = { trustedKeys: { release: keys.publicKey }, audience: "test/buffers" };
const snapshot = { schemaVersion: 1 as const, flags: {} };
const now = Date.now();
const artifact = signFlagSnapshot({
  snapshot,
  privateKey: keys.privateKey,
  keyId: "release",
  audience: verification.audience,
  sequence: 1,
  issuedAt: now - 1000,
  expiresAt: now + 3_600_000
});
const journal = Buffer.from(`${JSON.stringify({ schemaVersion: 1, artifacts: [artifact] })}\n`);
let directory: string;
let path: string;
let cap: number;
let reportedSize: number | undefined;
let allocatedBytes: number;
let buffers: WeakSet<Buffer>;
let backingBytes: number;
let backingStores: WeakSet<ArrayBufferLike>;
let handles: FileHandle[];
let closes: number;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-store-buffers-"));
  path = join(directory, "state.json");
  cap = 65536;
  reportedSize = undefined;
  allocatedBytes = backingBytes = closes = 0;
  buffers = new WeakSet();
  backingStores = new WeakSet();
  handles = [];
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    handles.push(handle);
    return {
      async stat(options?: { bigint?: boolean }) {
        const stats = options?.bigint ? await handle.stat({ bigint: true }) : await handle.stat();
        if (reportedSize !== undefined)
          stats.size = options?.bigint ? BigInt(reportedSize) : reportedSize;
        return stats;
      },
      async read(
        buffer: Buffer,
        offset = 0,
        length = buffer.length - offset,
        position: number | null = null
      ) {
        if (!buffers.has(buffer)) {
          buffers.add(buffer);
          allocatedBytes += buffer.length;
        }
        if (!backingStores.has(buffer.buffer)) {
          backingStores.add(buffer.buffer);
          backingBytes += buffer.buffer.byteLength;
        }
        return handle.read(buffer, offset, Math.min(length, cap), position);
      },
      async close() {
        closes++;
        await handle.close();
      }
    } as never;
  });
  await writeFile(path, journal);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(open).mockClear();
  await Promise.allSettled(
    handles.filter((handle) => handle.fd >= 0).map((handle) => handle.close())
  );
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-store-buffers-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
function store(maxBytes = 16 * 1024 * 1024) {
  return createFileSnapshotStore({ path, verification, maxBytes });
}
it.each([1, 7, 65536])(
  "bounds input allocation with %s-byte reads and preserves recovery",
  async (size) => {
    cap = size;
    const recovered = await store().load();
    expect(recovered?.current?.snapshot).toEqual(snapshot);
    expect(recovered?.floor.sequence).toBe(1);
    expect(closes).toBe(1);
    console.info(
      JSON.stringify({
        journalBytes: journal.length,
        readCap: cap,
        inputBufferBytes: allocatedBytes,
        distinctBackingBytes: backingBytes
      })
    );
    expect(allocatedBytes).toBe(journal.length + 1);
    expect(backingBytes).toBeLessThanOrEqual(Math.max(Buffer.poolSize, journal.length + 1));
  }
);
it("grows geometrically when the opened file grows after stat", async () => {
  reportedSize = 0;
  cap = 7;
  expect((await store().load())?.floor.sequence).toBe(1);
  expect(allocatedBytes).toBeLessThan(4 * (journal.length + 1));
  expect(closes).toBe(1);
});
it("accepts exactly maxBytes but rejects a byte beyond it even after stale stat", async () => {
  expect((await store(journal.length).load())?.floor.sequence).toBe(1);
  reportedSize = 0;
  cap = 7;
  await expect(store(journal.length - 1).load()).rejects.toMatchObject({
    code: "PROVIDER_NOT_READY"
  });
  expect(closes).toBe(2);
});
it("decodes only bytes read when the opened file shrinks after stat", async () => {
  reportedSize = journal.length + 500;
  expect((await store().load())?.current?.snapshot).toEqual(snapshot);
  expect(allocatedBytes).toBe(reportedSize + 1);
  expect(closes).toBe(1);
});

it("reads across full 64 KiB blocks and rejects malformed UTF-8 after a valid journal", async () => {
  const bytes = Buffer.concat([Buffer.alloc(131073, 32), journal]);
  await writeFile(path, bytes);
  expect((await store(bytes.length).load())?.floor.sequence).toBe(1);
  expect(allocatedBytes).toBe(bytes.length + 1);
  await writeFile(path, Buffer.concat([journal, Buffer.from([0xc3])]));
  cap = 1;
  await expect(store().load()).rejects.toMatchObject({ code: "PROVIDER_NOT_READY" });
  expect(closes).toBe(2);
});

it("rejects an oversized 64-bit stat before allocating an input buffer", async () => {
  reportedSize = Number.MAX_SAFE_INTEGER;
  await expect(store().load()).rejects.toMatchObject({ code: "PROVIDER_NOT_READY" });
  expect(allocatedBytes).toBe(0);
  expect(closes).toBe(1);
});
