import { cleanupAuditResource } from "./cleanup.js";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
export async function* readChainLines(
  path: string,
  budget: { remaining: number },
  maxRecordBytes: number
): AsyncGenerator<string> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error();
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  let failure: { cause: unknown } | undefined;
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.size > budget.remaining
    )
      throw new Error();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, budget.remaining + 1));
      const { bytesRead } = await handle.read(buffer);
      budget.remaining -= bytesRead;
      if (budget.remaining < 0) throw new Error();
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: bytesRead !== 0 });
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline === -1) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.length || Buffer.byteLength(line) > maxRecordBytes) throw new Error();
        yield line;
      }
      if (Buffer.byteLength(pending) > maxRecordBytes) throw new Error();
      if (bytesRead === 0) {
        if (pending.length !== 0) throw new Error();
        return;
      }
    }
  } catch (error) {
    failure = { cause: error };
    throw error;
  } finally {
    await cleanupAuditResource(() => handle.close(), failure, "Audit chain read and close failed.");
  }
}
