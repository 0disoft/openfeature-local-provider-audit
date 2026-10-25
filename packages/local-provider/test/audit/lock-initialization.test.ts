import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { acquireFileLock } from "../../src/audit/audit-sink.js";

let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-lock-init-"));
  path = join(directory, "audit.lock");
});
afterEach(async () => {
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-lock-init-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});
function options() {
  return { path, timeoutMs: 0, retryMs: 1, staleMs: undefined };
}
it.each([1, 8, 35])(
  "cleans its own %s-byte partial owner token after initialization failure",
  async (length) => {
    const failure = Object.assign(new Error("simulated disk full"), { code: "ENOSPC" });
    await expect(
      acquireFileLock(options(), async (handle, contents) => {
        await handle.writeFile(contents.slice(0, length));
        throw failure;
      })
    ).rejects.toBe(failure);
    const release = await acquireFileLock(options());
    await release();
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
);
it("preserves a foreign empty replacement during failed initialization", async () => {
  const failure = new Error("initialization failed after replacement");
  await expect(
    acquireFileLock(options(), async () => {
      await rename(path, join(directory, "original"));
      await writeFile(path, "");
      throw failure;
    })
  ).rejects.toBe(failure);
  expect(await readFile(path, "utf8")).toBe("");
  await expect(acquireFileLock(options())).rejects.toThrow("Timed out acquiring");
});
it("preserves a foreign replacement even when it copies the old owner record", async () => {
  const release = await acquireFileLock(options());
  const contents = await readFile(path);
  await rename(path, join(directory, "original"));
  await writeFile(path, contents);
  await release();
  expect(await readFile(path)).toEqual(contents);
});
