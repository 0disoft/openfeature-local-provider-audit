import { appendFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
import { serializeAuditEvent } from "./audit-event.js";

export function createFileAuditSink(options: FileAuditSinkOptions): AuditSink {
  const auditPath = options.path;
  const shouldCreateDirectory = options.createDirectory !== false;
  const rotation = createRotationOptions(options);
  const lock = createLockOptions(options, auditPath);
  const pendingWrites = new Set<Promise<void>>();
  let writeQueue = Promise.resolve();

  return {
    async write(event: AuditEvent): Promise<void> {
      const writeOperation = writeQueue.then(() =>
        writeAuditEvent(auditPath, shouldCreateDirectory, rotation, lock, event)
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
  lock: LockOptions | undefined,
  event: AuditEvent
): Promise<void> {
  const auditLine = serializeAuditEvent(event);

  if (shouldCreateDirectory) {
    await mkdir(dirname(toPathString(auditPath)), { recursive: true });
  }

  if (lock !== undefined) {
    await withFileLock(lock, async () => {
      await rotateAndAppend(auditPath, rotation, auditLine);
    });
    return;
  }

  await rotateAndAppend(auditPath, rotation, auditLine);
}

async function rotateAndAppend(
  auditPath: string | URL,
  rotation: RotationOptions | undefined,
  auditLine: string
): Promise<void> {
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

interface LockOptions {
  readonly path: string;
  readonly timeoutMs: number;
  readonly staleMs: number | undefined;
  readonly retryMs: number;
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

function createLockOptions(
  options: FileAuditSinkOptions,
  auditPath: string | URL
): LockOptions | undefined {
  if (options.lock !== true) {
    return undefined;
  }

  const timeoutMs = options.lockTimeoutMs ?? 5000;
  assertNonNegativeInteger(timeoutMs, "lockTimeoutMs");

  if (options.staleLockMs !== undefined) {
    assertNonNegativeInteger(options.staleLockMs, "staleLockMs");
  }

  return {
    path: `${toPathString(auditPath)}.lock`,
    timeoutMs,
    staleMs: options.staleLockMs,
    retryMs: 20
  };
}

async function withFileLock(lock: LockOptions, operation: () => Promise<void>): Promise<void> {
  const release = await acquireFileLock(lock);

  try {
    await operation();
  } finally {
    await release();
  }
}

async function acquireFileLock(lock: LockOptions): Promise<() => Promise<void>> {
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await open(lock.path, "wx");
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");

      return async () => {
        await handle.close();
        await removeIfExists(lock.path);
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      if (lock.staleMs !== undefined) {
        await removeStaleLockIfNeeded(lock);
      }

      if (Date.now() - startedAt >= lock.timeoutMs) {
        throw new Error(`Timed out acquiring audit file lock: ${lock.path}`);
      }

      await delay(lock.retryMs);
    }
  }
}

async function removeStaleLockIfNeeded(lock: LockOptions): Promise<void> {
  if (lock.staleMs === undefined) {
    return;
  }

  try {
    const lockStats = await stat(lock.path);
    if (Date.now() - lockStats.mtimeMs >= lock.staleMs) {
      await removeIfExists(lock.path);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
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

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "EEXIST"
  );
}

function toPathString(path: string | URL): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}
