import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
import { serializeAuditEvent } from "./audit-event.js";

export function createFileAuditSink(options: FileAuditSinkOptions): AuditSink {
  const auditPath = options.path;
  const shouldCreateDirectory = options.createDirectory !== false;

  return {
    async write(event: AuditEvent): Promise<void> {
      if (shouldCreateDirectory) {
        await mkdir(dirname(toPathString(auditPath)), { recursive: true });
      }

      await appendFile(auditPath, serializeAuditEvent(event), {
        encoding: "utf8",
        flag: "a"
      });
    }
  };
}

function toPathString(path: string | URL): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}
