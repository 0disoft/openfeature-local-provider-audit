import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
import { serializeAuditEvent } from "./audit-event.js";

export function createFileAuditSink(options: FileAuditSinkOptions): AuditSink {
  const auditPath = options.path;
  const shouldCreateDirectory = options.createDirectory !== false;
  const rotation = createRotationOptions(options);
  const pendingWrites = new Set<Promise<void>>();
  let writeQueue = Promise.resolve();

  return {
    async write(event: AuditEvent): Promise<void> {
      const writeOperation = writeQueue.then(() =>
        writeAuditEvent(auditPath, shouldCreateDirectory, rotation, event)
      );
      writeQueue = writeOperation.catch(() => undefined);
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
  rotation: RotationOptions | undefined,
  event: AuditEvent
): Promise<void> {
  const auditLine = serializeAuditEvent(event);

  if (shouldCreateDirectory) {
    await mkdir(dirname(toPathString(auditPath)), { recursive: true });
  }

  if (rotation !== undefined) {
    await rotateIfNeeded(auditPath, rotation, Buffer.byteLength(auditLine, "utf8"));
  }

  await appendFile(auditPath, auditLine, {
    encoding: "utf8",
    flag: "a"
  });
}

interface RotationOptions {
  readonly maxBytes: number;
  readonly maxFiles: number;
}

function createRotationOptions(options: FileAuditSinkOptions): RotationOptions | undefined {
  if (options.maxBytes === undefined) {
    return undefined;
  }

  assertNonNegativeInteger(options.maxBytes, "maxBytes");
  if (options.maxBytes === 0) {
    throw new RangeError("maxBytes must be greater than 0");
  }

  const maxFiles = options.maxFiles ?? 5;
  assertNonNegativeInteger(maxFiles, "maxFiles");

  return {
    maxBytes: options.maxBytes,
    maxFiles
  };
}

async function rotateIfNeeded(
  auditPath: string | URL,
  rotation: RotationOptions,
  nextWriteBytes: number
): Promise<void> {
  const auditPathString = toPathString(auditPath);
  const currentSize = await getExistingFileSize(auditPathString);

  if (currentSize + nextWriteBytes <= rotation.maxBytes) {
    return;
  }

  if (rotation.maxFiles === 0) {
    await removeIfExists(auditPathString);
    return;
  }

  await removeIfExists(rotatedPath(auditPathString, rotation.maxFiles));

  for (let index = rotation.maxFiles - 1; index >= 1; index -= 1) {
    await renameIfExists(
      rotatedPath(auditPathString, index),
      rotatedPath(auditPathString, index + 1)
    );
  }

  await renameIfExists(auditPathString, rotatedPath(auditPathString, 1));
}

async function getExistingFileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }

    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function renameIfExists(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function rotatedPath(path: string, index: number): string {
  return `${path}.${index}`;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function toPathString(path: string | URL): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}
