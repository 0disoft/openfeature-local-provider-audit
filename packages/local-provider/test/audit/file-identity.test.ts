import { lstat, open } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { openChainFile } from "../../src/audit/chain-files.js";
import { readChainLines } from "../../src/audit/read-chain-lines.js";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  lstat: vi.fn(),
  open: vi.fn()
}));
afterEach(() => vi.resetAllMocks());

function fixture(field: "dev" | "ino", replaced: boolean) {
  const original = 9_007_199_254_740_992n;
  const replacement = original + (replaced ? 1n : 0n);
  expect(Number(original)).toBe(Number(replacement));
  function stats(value: bigint, exact = false) {
    const values = {
      dev: 1n,
      ino: 2n,
      nlink: 1n,
      uid: BigInt(process.geteuid?.() ?? 0),
      size: 3n,
      [field]: value
    };
    return {
      ...Object.fromEntries(
        Object.entries(values).map(([key, entry]) => [key, exact ? entry : Number(entry)])
      ),
      isFile: () => true,
      isSymbolicLink: () => false
    };
  }
  vi.mocked(lstat).mockImplementation(
    async (_path, options) => stats(original, options?.bigint) as never
  );
  let read = false;
  const handle = {
    stat: vi.fn(async (options?: { bigint?: boolean }) => stats(replacement, options?.bigint)),
    writeFile: vi.fn(async () => {}),
    read: vi.fn(async (buffer: Buffer, offset: number) => {
      if (read) return { buffer, bytesRead: 0 };
      read = true;
      buffer.write("ok\n", offset);
      return { buffer, bytesRead: 3 };
    }),
    close: vi.fn(async () => {})
  };
  vi.mocked(open).mockResolvedValue(handle as never);
  return handle;
}
async function useFile(consumer: "writer" | "reader") {
  if (consumer === "writer") {
    const handle = await openChainFile("audit.jsonl");
    try {
      await handle.writeFile("new audit record\n");
    } finally {
      await handle.close();
    }
    return [];
  }
  const lines: string[] = [];
  for await (const line of readChainLines("audit.jsonl", { remaining: 16 }, 16)) lines.push(line);
  return lines;
}
it.each([
  ["writer", "ino"],
  ["writer", "dev"],
  ["reader", "ino"],
  ["reader", "dev"]
] as const)(
  "%s rejects a replacement whose %s collides after Number conversion",
  async (consumer, field) => {
    const handle = fixture(field, true);
    await expect(useFile(consumer)).rejects.toThrow();
    expect(handle.read).not.toHaveBeenCalled();
    expect(handle.writeFile).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
    expect(handle.stat).toHaveBeenCalledOnce();
    expect(lstat).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  }
);
it.each(["writer", "reader"] as const)(
  "%s accepts an unchanged file with a large exact ID",
  async (consumer) => {
    const handle = fixture("ino", false);
    await expect(useFile(consumer)).resolves.toEqual(consumer === "reader" ? ["ok"] : []);
    expect(handle.close).toHaveBeenCalledOnce();
  }
);
