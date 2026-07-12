import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
import { serializeAuditEvent } from "./audit-event.js";

const AUDIT_FILE_MODE = 0o600;
const AUDIT_DIRECTORY_MODE = 0o700;
const MAX_RETAINED_FAILURE_CAUSES = 16;
const AUDIT_OPEN_FLAGS =
  constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
const processWriteQueues = new Map<string, Promise<void>>();

export function createFileAuditSink(options: FileAuditSinkOptions): AuditSink {
  const auditPath = options.path;
  const shouldCreateDirectory = options.createDirectory !== false;
  const rotation = createRotationOptions(options);
  const lock = createLockOptions(options, auditPath);
  const queue = createQueueOptions(options);
  const pendingWrites = new Set<Promise<void>>();
  const failureCauses: unknown[] = [];
  let unreportedFailureCount = 0;
  let queuedWrites = 0;
  let droppedWrites = 0;
  let writeQueue = Promise.resolve();
  let flushQueue = Promise.resolve();

  return {
    async write(event: AuditEvent): Promise<void> {
      if (queue.maxSize !== undefined && queuedWrites >= queue.maxSize) {
        if (queue.overflowPolicy === "dropNewest") {
          droppedWrites += 1;
          return;
        }

        throw new Error(`Audit write queue is full: maxQueueSize=${queue.maxSize}`);
      }

      queuedWrites += 1;
      const writeOperation = writeQueue.then(() =>
        writeAuditEvent(auditPath, shouldCreateDirectory, rotation, lock, event)
      );
      writeQueue = writeOperation.catch(() => undefined);
      const trackedWrite = writeOperation
        .catch((error: unknown) => {
          unreportedFailureCount += 1;
          if (failureCauses.length < MAX_RETAINED_FAILURE_CAUSES) {
            failureCauses.push(error);
          }
          throw error;
        })
        .finally(() => {
          queuedWrites -= 1;
          pendingWrites.delete(trackedWrite);
        });

      pendingWrites.add(trackedWrite);

      await trackedWrite;
    },

    async flush(): Promise<void> {
      const flushOperation = flushQueue.then(async () => {
        while (pendingWrites.size > 0) {
          await Promise.allSettled(Array.from(pendingWrites));
        }

        const failureCount = unreportedFailureCount;
        const retainedCauses = failureCauses.splice(0);
        unreportedFailureCount = 0;
        if (failureCount === 1) {
          throw retainedCauses[0];
        }
        if (failureCount > 1) {
          throw new AggregateError(
            retainedCauses,
            `${failureCount} audit writes failed before flush; retained up to ${MAX_RETAINED_FAILURE_CAUSES} causes.`
          );
        }
      });
      flushQueue = flushOperation.catch(() => undefined);
      await flushOperation;
    },

    getStats() {
      return {
        pendingWrites: queuedWrites,
        droppedWrites
      };
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
  const auditPathString = resolve(toPathString(auditPath));

  await serializeProcessWrite(auditPathString, async () => {
    if (shouldCreateDirectory) {
      await mkdir(dirname(auditPathString), {
        recursive: true,
        mode: AUDIT_DIRECTORY_MODE
      });
    }

    if (lock !== undefined) {
      await withFileLock(lock, async () => {
        await rotateAndAppend(auditPathString, rotation, auditLine);
      });
      return;
    }

    await rotateAndAppend(auditPathString, rotation, auditLine);
  });
}

async function rotateAndAppend(
  auditPath: string | URL,
  rotation: RotationOptions | undefined,
  auditLine: string
): Promise<void> {
  await assertPathIsNotSymbolicLink(toPathString(auditPath));
  if (rotation !== undefined) {
    await rotateIfNeeded(auditPath, rotation, Buffer.byteLength(auditLine, "utf8"));
  }

  await appendAuditLine(toPathString(auditPath), auditLine);
}

async function appendAuditLine(path: string, auditLine: string): Promise<void> {
  await assertPathIsNotSymbolicLink(path);
  const handle = await open(path, AUDIT_OPEN_FLAGS, AUDIT_FILE_MODE);

  try {
    const fileStats = await handle.stat();
    if (!fileStats.isFile()) {
      throw new Error(`Audit path must be a regular file: ${path}`);
    }
    if (fileStats.nlink !== 1) {
      throw new Error(`Audit path must not have multiple hard links: ${path}`);
    }
    if (typeof process.geteuid === "function" && fileStats.uid !== process.geteuid()) {
      throw new Error(`Audit file must be owned by the current user: ${path}`);
    }
    await handle.appendFile(auditLine, "utf8");
  } finally {
    await handle.close();
  }
}

async function assertPathIsNotSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`Audit path must not be a symbolic link: ${path}`);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function serializeProcessWrite(path: string, operation: () => Promise<void>): Promise<void> {
  const previous = processWriteQueues.get(path) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  processWriteQueues.set(path, tail);

  try {
    await current;
  } finally {
    if (processWriteQueues.get(path) === tail) {
      processWriteQueues.delete(path);
    }
  }
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

interface QueueOptions {
  readonly maxSize: number | undefined;
  readonly overflowPolicy: NonNullable<FileAuditSinkOptions["queueOverflowPolicy"]>;
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

function createQueueOptions(options: FileAuditSinkOptions): QueueOptions {
  if (
    options.queueOverflowPolicy !== undefined &&
    options.queueOverflowPolicy !== "reject" &&
    options.queueOverflowPolicy !== "dropNewest"
  ) {
    throw new TypeError("queueOverflowPolicy must be reject or dropNewest");
  }

  if (options.maxQueueSize === undefined) {
    return {
      maxSize: undefined,
      overflowPolicy: options.queueOverflowPolicy ?? "reject"
    };
  }

  assertNonNegativeInteger(options.maxQueueSize, "maxQueueSize");
  if (options.maxQueueSize === 0) {
    throw new RangeError("maxQueueSize must be greater than 0");
  }

  return {
    maxSize: options.maxQueueSize,
    overflowPolicy: options.queueOverflowPolicy ?? "reject"
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

type LockRecordWriter = (handle: FileHandle, contents: string) => Promise<void>;

export async function acquireFileLock(
  lock: LockOptions,
  writeLockRecord: LockRecordWriter = defaultWriteLockRecord
): Promise<() => Promise<void>> {
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await open(lock.path, "wx");
      const ownerToken = randomUUID();

      try {
        await writeLockRecord(
          handle,
          `${ownerToken}\n${process.pid}\n${new Date().toISOString()}\n`
        );
      } catch (error) {
        try {
          await handle.close();
        } catch {
          // Preserve the initialization error; ownership cleanup still gets a chance.
        }
        await removeLockIfOwned(lock.path, ownerToken, true);
        throw error;
      }

      return async () => {
        await handle.close();
        await removeLockIfOwned(lock.path, ownerToken);
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

async function defaultWriteLockRecord(handle: FileHandle, contents: string): Promise<void> {
  await handle.writeFile(contents, "utf8");
}

async function removeLockIfOwned(
  path: string,
  ownerToken: string,
  allowEmpty = false
): Promise<void> {
  try {
    const contents = await readFile(path, "utf8");
    const recordedOwner = contents.split("\n", 1)[0];
    if (recordedOwner === ownerToken || (allowEmpty && recordedOwner === "")) {
      await removeIfExists(path);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
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
    ((error as { readonly code?: unknown }).code === "EEXIST" ||
      (error as { readonly code?: unknown }).code === "EPERM")
  );
}

function toPathString(path: string | URL): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}
