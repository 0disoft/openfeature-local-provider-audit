import { afterEach, expect, it, vi } from "vitest";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { withAuditCleanup } from "../../src/audit/cleanup.js";
import { readChainLines } from "../../src/audit/read-chain-lines.js";
import { writeChainMetadata } from "../../src/audit/chain-files.js";
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  lstat: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn()
}));
afterEach(() => vi.resetAllMocks());

it("retains successful values and original single failures while always cleaning once", async () => {
  const cleanup = vi.fn(async () => {});
  const original = new Error("operation failed");
  await expect(withAuditCleanup(async () => 42, cleanup, "both failed")).resolves.toBe(42);
  await expect(
    withAuditCleanup(
      async () => {
        throw original;
      },
      cleanup,
      "both failed"
    )
  ).rejects.toBe(original);
  expect(cleanup).toHaveBeenCalledTimes(2);
  const failure = new Error("cleanup failed");
  await expect(
    withAuditCleanup(
      async () => 42,
      async () => {
        throw failure;
      },
      "both failed"
    )
  ).rejects.toBe(failure);
});
it.each([undefined, new Error("operation failed")])(
  "retains even a thrown undefined alongside cleanup failure",
  async (original) => {
    const cleanup = new Error("cleanup failed");
    await expect(
      withAuditCleanup(
        async () => {
          throw original;
        },
        async () => {
          throw cleanup;
        },
        "both failed"
      )
    ).rejects.toMatchObject({ cause: original, errors: [original, cleanup] });
  }
);
it("keeps publication and temporary-file deletion errors together", async () => {
  const publication = new Error("private rename path"),
    deletion = new Error("private temp path");
  const close = vi.fn(async () => {});
  vi.mocked(open).mockResolvedValue({
    writeFile: async () => {},
    sync: async () => {},
    close
  } as never);
  vi.mocked(rename).mockRejectedValue(publication);
  vi.mocked(unlink).mockRejectedValue(deletion);
  await expect(writeChainMetadata("audit/manifest.json", {})).rejects.toMatchObject({
    cause: publication,
    errors: [publication, deletion]
  });
  expect(close).toHaveBeenCalledOnce();
  expect(unlink).toHaveBeenCalledOnce();
});
it("retains write, close and temporary-file deletion errors and never publishes failed data", async () => {
  const write = new Error("write"),
    close = new Error("close"),
    deletion = new Error("unlink");
  vi.mocked(open).mockResolvedValue({
    writeFile: async () => {
      throw write;
    },
    close: async () => {
      throw close;
    }
  } as never);
  vi.mocked(unlink).mockRejectedValue(deletion);
  await expect(writeChainMetadata("audit/manifest.json", {})).rejects.toMatchObject({
    cause: { cause: write, errors: [write, close] },
    errors: [{ cause: write }, deletion]
  });
  expect(rename).not.toHaveBeenCalled();
  expect(unlink).toHaveBeenCalledOnce();
});

it("retains streaming read and close failures while releasing its handle", async () => {
  const read = new Error("read failed"),
    close = new Error("close failed");
  const stats = { isFile: () => true, isSymbolicLink: () => false, ino: 1, dev: 1, size: 1 };
  vi.mocked(lstat).mockResolvedValue(stats as never);
  const release = vi.fn(async () => {
    throw close;
  });
  vi.mocked(open).mockResolvedValue({
    stat: async () => stats,
    read: async () => {
      throw read;
    },
    close: release
  } as never);
  const drain = async () => {
    for await (const line of readChainLines("audit/segment-1.jsonl", { remaining: 1024 }, 1024))
      void line;
  };
  await expect(drain()).rejects.toMatchObject({ cause: read, errors: [read, close] });
  expect(release).toHaveBeenCalledOnce();
});
