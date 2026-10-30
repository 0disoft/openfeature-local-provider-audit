import { getEventListeners } from "node:events";
import { mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireFileLock, withFileLock } from "../../src/audit/audit-sink.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-lock-cancel-"));
  path = join(directory, "audit.lock");
});
afterEach(async () => {
  vi.clearAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-lock-cancel-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
function options() {
  return { path, timeoutMs: 30_000, retryMs: 10_000, staleMs: undefined };
}

it("does not open a lock or start protected work with an already aborted signal", async () => {
  const reason = new Error("operator cancelled");
  const operation = vi.fn();
  await expect(withFileLock(options(), operation, AbortSignal.abort(reason))).rejects.toBe(reason);
  expect(open).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
});

it("interrupts a pending retry and preserves the foreign marker and original reason", async () => {
  await writeFile(path, "foreign owner");
  const controller = new AbortController();
  const reason = new Error("stop waiting");
  const waiting = acquireFileLock(options(), undefined, controller.signal);
  const rejected = expect(waiting).rejects.toBe(reason);
  // The native timer registers this listener only after contention was observed.
  await vi.waitFor(() => expect(getEventListeners(controller.signal, "abort")).toHaveLength(1));
  controller.abort(reason);
  await rejected;
  expect(open).toHaveBeenCalledOnce();
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  expect(await readFile(path, "utf8")).toBe("foreign owner");
});

it("closes the acquired handle and removes its marker when initialization is cancelled", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel during initialization");
  const closed = vi.fn();
  await expect(
    acquireFileLock(
      options(),
      async (handle, contents) => {
        const originalClose = handle.close.bind(handle);
        handle.close = async () => {
          closed();
          await originalClose();
        };
        await handle.writeFile(contents);
        controller.abort(reason);
      },
      controller.signal
    )
  ).rejects.toBe(reason);
  expect(closed).toHaveBeenCalledOnce();
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  const release = await acquireFileLock(options());
  await release();
});

it("preserves a replacement marker when cancellation follows initialization", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel after replacement");
  await expect(
    acquireFileLock(
      options(),
      async (handle, contents) => {
        await handle.writeFile(contents);
        await rename(path, join(directory, "original"));
        await writeFile(path, "new owner");
        controller.abort(reason);
      },
      controller.signal
    )
  ).rejects.toBe(reason);
  expect(await readFile(path, "utf8")).toBe("new owner");
});
