import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { withStoreCleanup } from "./store-cleanup.js";

export class DiagnosticReadError extends Error {
  constructor(readonly code: "UNSAFE_FILE" | "BYTE_LIMIT" | "CHANGED") {
    super(code);
  }
}

export function sameDiagnosticFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

function assertFile(stats: BigIntStats): void {
  if (
    !stats.isFile() ||
    stats.nlink !== 1n ||
    (process.getuid !== undefined && stats.uid !== BigInt(process.getuid()))
  )
    throw new DiagnosticReadError("UNSAFE_FILE");
}

// No mutating open or pathname-following fallback. Ancestor directories remain trusted.
export async function readDiagnosticText(
  path: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; before: BigIntStats }> {
  signal?.throwIfAborted();
  const before = await lstat(path, { bigint: true });
  assertFile(before);
  if (before.size > BigInt(maxBytes)) throw new DiagnosticReadError("BYTE_LIMIT");
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  return withStoreCleanup(
    async () => {
      signal?.throwIfAborted();
      const opened = await handle.stat({ bigint: true });
      assertFile(opened);
      if (!sameDiagnosticFile(before, opened)) throw new DiagnosticReadError("CHANGED");
      const buffer = Buffer.allocUnsafe(Number(before.size) + 1);
      let total = 0;
      while (total < buffer.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(
          buffer,
          total,
          Math.min(65536, buffer.length - total),
          null
        );
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      signal?.throwIfAborted();
      if (
        BigInt(total) !== before.size ||
        !sameDiagnosticFile(before, await handle.stat({ bigint: true })) ||
        !sameDiagnosticFile(before, await lstat(path, { bigint: true }))
      )
        throw new DiagnosticReadError("CHANGED");
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total)),
        before
      };
    },
    () => handle.close(),
    "Snapshot diagnostic read and close failed."
  );
}
