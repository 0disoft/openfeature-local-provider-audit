import { open, readFile, rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { acquireFileLock, withFileLock } from "../../src/audit/audit-sink.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(), readFile: vi.fn(), rm: vi.fn() };
});
afterEach(() => vi.resetAllMocks());

it.each([false, true])(
  "cleans its marker after close fails; deletion failure=%s",
  async (deletionFails) => {
    const closeFailure = new Error("close failed");
    const deleteFailure = new Error("delete failed");
    let contents = "";
    vi.mocked(open).mockResolvedValue({
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
