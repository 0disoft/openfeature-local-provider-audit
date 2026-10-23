import { cleanupResource } from "../errors/resource-cleanup.js";
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
    let parts: Buffer[] = [];
    let lineBytes = 0;
    let firstLine = true;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, budget.remaining + 1));
      const { bytesRead } = await handle.read(buffer);
      budget.remaining -= bytesRead;
      if (budget.remaining < 0) throw new Error();
      if (bytesRead === 0) {
        if (lineBytes === 0) return;
        // An initial BOM alone was historically an empty decoded file.
        if (firstLine && lineBytes === 3 && decoder.decode(Buffer.concat(parts, 3)) === "") return;
        throw new Error();
      }
      const chunk = buffer.subarray(0, bytesRead);
      let offset = 0;
      while (offset < bytesRead) {
        const newline = chunk.indexOf(10, offset);
        const complete = newline !== -1;
        const end = complete ? newline : bytesRead;
        lineBytes += end - offset;
        // The decoder strips only the file's initial UTF-8 BOM. Reserve its
        // three wire bytes until the first completed line is decoded.
        if (lineBytes > maxRecordBytes + (firstLine ? 3 : 0)) throw new Error();
        const fragment = chunk.subarray(offset, complete ? end + 1 : end);
        if (!complete) {
          parts.push(fragment);
          break;
        }
        const encoded =
          parts.length === 0 ? fragment : Buffer.concat([...parts, fragment], lineBytes + 1);
        // Including LF prevents an incomplete UTF-8 sequence crossing a line.
        // Streaming preserves the original file-level BOM behavior across lines.
        const line = decoder.decode(encoded, { stream: true }).slice(0, -1);
        if (!line.length || Buffer.byteLength(line) > maxRecordBytes) throw new Error();
        parts = [];
        lineBytes = 0;
        firstLine = false;
        offset = end + 1;
        yield line;
      }
    }
  } catch (error) {
    failure = { cause: error };
    throw error;
  } finally {
    await cleanupResource(() => handle.close(), failure, "Audit chain read and close failed.");
  }
}
