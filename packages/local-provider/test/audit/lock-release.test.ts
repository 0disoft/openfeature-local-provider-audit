import { lstat, open, readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireFileLock, withFileLock } from "../../src/audit/audit-sink.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(), open: vi.fn(), readFile: vi.fn(), rm: vi.fn() };
});
const identity = { dev: 1n, ino: 2n, isFile: () => true };
beforeEach(() => vi.mocked(lstat).mockResolvedValue(identity as never));
afterEach(() => vi.resetAllMocks());

it.each([false, true])(
  "cleans its marker after close fails; deletion failure=%s",
  async (deletionFails) => {
    const closeFailure = new Error("close failed");
    const deleteFailure = new Error("delete failed");
    let contents = "";
    vi.mocked(open).mockResolvedValue({
      stat: async () => identity,
      writeFile: async (text: string) => {
        contents = text;
      },
      close: async () => {
        throw closeFailure;
      }
    } as never);
    vi.mocked(readFile).mockImplementation(async () => contents as never);
    if (deletionFails) vi.mocked(rm).mockRejectedValue(deleteFailure);
    else vi.mocked(rm).mockResolvedValue(undefined);
    const release = await acquireFileLock({
      path: "owned.lock",
      timeoutMs: 0,
      retryMs: 1,
      staleMs: undefined
    });
    if (deletionFails)
      await expect(release()).rejects.toMatchObject({ errors: [closeFailure, deleteFailure] });
    else await expect(release()).rejects.toBe(closeFailure);
    expect(rm).toHaveBeenCalledWith("owned.lock", { force: true });
  }
);

it("does not remove a foreign marker when close fails", async () => {
  vi.mocked(open).mockResolvedValue({
    stat: async () => identity,
    writeFile: async () => {},
    close: async () => {
      throw new Error("close");
    }
  } as never);
  vi.mocked(readFile).mockResolvedValue("foreign-owner\n");
  const release = await acquireFileLock({
    path: "owned.lock",
    timeoutMs: 0,
    retryMs: 1,
    staleMs: undefined
  });
  await expect(release()).rejects.toThrow("close");
  expect(rm).not.toHaveBeenCalled();
});

it("rejects stale takeover before touching a lock", async () => {
  await expect(
    acquireFileLock({ path: "live.lock", timeoutMs: 0, retryMs: 1, staleMs: 1 })
  ).rejects.toThrow("unsupported");
  expect(open).not.toHaveBeenCalled();
});

it("preserves operation failure when releasing the lock also fails", async () => {
  const original = new Error("append failed"),
    close = new Error("close failed");
  let contents = "";
  vi.mocked(open).mockResolvedValue({
    stat: async () => identity,
    writeFile: async (value: string) => {
      contents = value;
    },
    close: async () => {
      throw close;
    }
  } as never);
  vi.mocked(readFile).mockImplementation(async () => contents as never);
  vi.mocked(rm).mockResolvedValue(undefined);
  await expect(
    withFileLock({ path: "owned.lock", timeoutMs: 0, retryMs: 1, staleMs: undefined }, async () => {
      throw original;
    })
  ).rejects.toMatchObject({ cause: original, errors: [original, close] });
  expect(rm).toHaveBeenCalledOnce();
});

it("preserves initialization, close and deletion errors without treating initialization as contention", async () => {
  const original = Object.assign(new Error("initialization failed"), { code: "EEXIST" });
  const close = new Error("close failed"),
    deletion = new Error("delete failed");
  vi.mocked(open).mockResolvedValue({
    stat: async () => identity,
    close: async () => {
      throw close;
    }
  } as never);
  vi.mocked(readFile).mockResolvedValue("");
  vi.mocked(rm).mockRejectedValue(deletion);
  await expect(
    acquireFileLock(
      { path: "owned.lock", timeoutMs: 0, retryMs: 1, staleMs: undefined },
      async () => {
        throw original;
      }
    )
  ).rejects.toMatchObject({ cause: original, errors: [original, { errors: [close, deletion] }] });
  expect(open).toHaveBeenCalledOnce();
  expect(rm).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "preserves unknown-identity markers and stat/close errors; close failure=%s",
  async (closeFails) => {
    const failure = new Error("stat failed"),
      closing = new Error("close failed");
    const close = vi.fn(async () => {
      if (closeFails) throw closing;
    });
    const write = vi.fn(async () => {});
    vi.mocked(open).mockResolvedValue({
      stat: async () => {
        throw failure;
      },
      close
    } as never);
    const operation = acquireFileLock(
      { path: "unknown.lock", timeoutMs: 0, retryMs: 1, staleMs: undefined },
      write
    );
    if (closeFails)
      await expect(operation).rejects.toMatchObject({ cause: failure, errors: [failure, closing] });
    else await expect(operation).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  }
);

it.each([
  ["ino", 19_421_773_397_387_012n],
  ["ino", 9_007_199_254_740_992n],
  ["ino", 1_152_921_504_606_846_976n],
  ["dev", 9_007_199_254_740_992n]
] as const)(
  "preserves a replacement with distinct 64-bit %s after Number rounding at %s",
  async (field, original) => {
    const replacement = original + 1n;
    expect(Number(original)).toBe(Number(replacement));
    const stats = (value: bigint, exact = false) => {
      const identity = { dev: 1n, ino: 2n, [field]: value };
      return {
        isFile: () => true,
        dev: exact ? identity.dev : Number(identity.dev),
        ino: exact ? identity.ino : Number(identity.ino)
      };
    };
    let contents = "";
    const stat = vi.fn(async (options?: { bigint?: boolean }) => stats(original, options?.bigint));
    const close = vi.fn(async () => {});
    vi.mocked(open).mockResolvedValue({
      stat,
      close,
      writeFile: async (text: string) => {
        contents = text;
      }
    } as never);
    vi.mocked(lstat).mockImplementation(
      async (_path, options) => stats(replacement, options?.bigint) as never
    );
    vi.mocked(readFile).mockImplementation(async () => contents as never);
    const release = await acquireFileLock({
      path: "owned.lock",
      timeoutMs: 0,
      retryMs: 1,
      staleMs: undefined
    });
    await release();
    expect(close).toHaveBeenCalledOnce();
    expect(readFile).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    expect(stat).toHaveBeenCalledWith({ bigint: true });
    expect(lstat).toHaveBeenCalledWith("owned.lock", { bigint: true });
  }
);
