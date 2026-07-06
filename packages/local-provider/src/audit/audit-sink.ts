import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
import { serializeAuditEvent } from "./audit-event.js";

export function createFileAuditSink(options: FileAuditSinkOptions): AuditSink {
  const auditPath = options.path;
  const shouldCreateDirectory = options.createDirectory !== false;
  const pendingWrites = new Set<Promise<void>>();

  return {
    async write(event: AuditEvent): Promise<void> {
      const writeOperation = writeAuditEvent(auditPath, shouldCreateDirectory, event);
      const trackedWrite = writeOperation.finally(() => {
        pendingWrites.delete(trackedWrite);
      });

      pendingWrites.add(trackedWrite);

      await trackedWrite;
    },

    async flush(): Promise<void> {
      while (pendingWrites.size > 0) {
        await Promise.all(Array.from(pendingWrites));
      }
    }
  };
}

async function writeAuditEvent(
  auditPath: string | URL,
  shouldCreateDirectory: boolean,
  event: AuditEvent
): Promise<void> {
  if (shouldCreateDirectory) {
    await mkdir(dirname(toPathString(auditPath)), { recursive: true });
  }

  await appendFile(auditPath, serializeAuditEvent(event), {
    encoding: "utf8",
    flag: "a"
  });
}

function toPathString(path: string | URL): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}
