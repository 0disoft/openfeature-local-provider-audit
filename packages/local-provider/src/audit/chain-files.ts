import { withAuditCleanup } from "./cleanup.js";
import { constants, type BigIntStats, type Stats } from "node:fs";
import { lstat, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export function assertOwnedFile(stats: Stats | BigIntStats): void {
  if (
    !stats.isFile() ||
    BigInt(stats.nlink) !== 1n ||
    (process.geteuid !== undefined && BigInt(stats.uid) !== BigInt(process.geteuid()))
  )
    throw new Error();
}
export async function openChainFile(path: string): Promise<FileHandle> {
  return openOwnedChainFile(path, constants.O_RDWR | constants.O_APPEND);
}
export async function openReadOnlyChainFile(path: string): Promise<FileHandle> {
  return openOwnedChainFile(path, constants.O_RDONLY);
}
async function openOwnedChainFile(path: string, flags: number): Promise<FileHandle> {
  const before = await lstat(path, { bigint: true });
  assertOwnedFile(before);
  const handle = await open(
    path,
    flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const after = await handle.stat({ bigint: true });
    assertOwnedFile(after);
    if (after.ino !== before.ino || after.dev !== before.dev) throw new Error();
    return handle;
  } catch (error) {
    return withAuditCleanup(
      async () => {
        throw error;
      },
      () => handle.close(),
      "Audit file validation and close failed."
    );
  }
}
export async function readChainRange(
  handle: FileHandle,
  offset: number,
  length: number
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, offset + read);
    if (result.bytesRead === 0) throw new Error();
    read += result.bytesRead;
  }
  return buffer;
}
export async function readChainMetadata(
  path: string,
  readOnly = false
): Promise<unknown | undefined> {
  let handle: FileHandle;
  try {
    handle = await (readOnly ? openReadOnlyChainFile(path) : openChainFile(path));
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  return withAuditCleanup(
    async () => {
      const size = (await handle.stat()).size;
      if (size > 256 * 1024) throw new Error();
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await readChainRange(handle, 0, size))
      );
    },
    () => handle.close(),
    "Audit metadata read and close failed."
  );
}
export async function writeChainMetadata(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.chain-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  await withAuditCleanup(
    async () => {
      await withAuditCleanup(
        async () => {
          await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
          await handle.sync();
        },
        () => handle.close(),
        "Audit metadata write and close failed."
      );
      await rename(temporary, path);
      await syncChainDirectory(dirname(path));
    },
    async () => {
      try {
        await unlink(temporary);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
    "Audit metadata publication and temporary-file cleanup failed."
  );
}

export async function syncChainDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  await withAuditCleanup(
    () => handle.sync(),
    () => handle.close(),
    "Audit directory sync and close failed."
  );
}
export function missing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

export async function readChainTail(
  handle: FileHandle,
  size: number,
  maxRecordBytes: number
): Promise<Buffer> {
  let length = Math.min(size, 4096, maxRecordBytes + 1);
  let retained = 0;
  const parts: Buffer[] = [];
  while (true) {
    // Grow only into the unread prefix; retained fragments are newest first.
    const prefix = await readChainRange(handle, size - length, length - retained);
    if (retained === 0 && prefix[prefix.length - 1] !== 10) throw new Error();
    const newline = prefix.lastIndexOf(10, prefix.length - (retained === 0 ? 2 : 1));
    const fragment = prefix.subarray(newline + 1);
    parts.push(fragment);
    if (newline !== -1 || length === size || length === maxRecordBytes + 1)
      return parts.length === 1 ? fragment : Buffer.concat(parts.reverse());
    retained = length;
    length = Math.min(size, length * 2, maxRecordBytes + 1);
  }
}
