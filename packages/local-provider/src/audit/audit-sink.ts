import { withAuditCleanup } from "./cleanup.js";
import { createQueuedAuditSink } from "./queued-sink.js";
import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
import { captureFileAuditEvent, serializeCapturedFileAuditEvent } from "./audit-event.js";

const FILE_AUDIT_BATCH_SIZE = 64;
const FILE_AUDIT_BATCH_BYTES = 64 * 1024;
const AUDIT_FILE_MODE = 0o600;
const AUDIT_DIRECTORY_MODE = 0o700;
const AUDIT_OPEN_FLAGS =
  constants.O_APPEND |
  constants.O_CREAT |
  constants.O_WRONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);
const processWriteQueues = new Map<string, Promise<void>>();

export function createFileAuditSink(options: FileAuditSinkOptions): AuditSink {
  const inputPath = options.path;
  const auditPath = typeof inputPath === "string" ? resolve(inputPath) : new URL(inputPath.href);
  const shouldCreateDirectory = options.createDirectory !== false;
  const rotation = createRotationOptions(options);
  const lock = createLockOptions(options, auditPath);
  const write = (events: readonly AuditEvent[]) =>
    writeAuditLines(
      auditPath,
      shouldCreateDirectory,
      rotation,
      lock,
      events.map(serializeCapturedFileAuditEvent).join("")
    );
  const queued = createQueuedAuditSink(
    options,
    (event) => write([event]),
    rotation === undefined && lock === undefined
      ? { maxSize: FILE_AUDIT_BATCH_SIZE, maxBytes: FILE_AUDIT_BATCH_BYTES, write }
      : undefined
  );
  return {
    ...queued,
    async write(event) {
      return queued.write(captureFileAuditEvent(event));
    },
    async writeConfirmed(event) {
      return queued.writeConfirmed?.(captureFileAuditEvent(event));
    }
  };
}

async function writeAuditLines(
  auditPath: string | URL,
  shouldCreateDirectory: boolean,
  rotation: RotationOptions | undefined,
  lock: LockOptions | undefined,
  auditLine: string
): Promise<void> {
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
  if (rotation !== undefined) {
    // Rotation touches paths before append's own pre-open check can protect them.
    await assertPathIsRegularFile(toPathString(auditPath));
    await rotateIfNeeded(auditPath, rotation, Buffer.byteLength(auditLine, "utf8"));
  }

  await appendAuditLine(toPathString(auditPath), auditLine);
}

async function appendAuditLine(path: string, auditLine: string): Promise<void> {
  await assertPathIsRegularFile(path);
  const handle = await open(path, AUDIT_OPEN_FLAGS, AUDIT_FILE_MODE);

  await withAuditCleanup(
    async () => {
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
    },
    () => handle.close(),
    "Audit append and handle close failed."
  );
}

async function assertPathIsRegularFile(path: string): Promise<void> {
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink()) {
      throw new Error(`Audit path must not be a symbolic link: ${path}`);
    }
    if (!before.isFile()) {
      throw new Error(`Audit path must be a regular file: ${path}`);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function serializeProcessWrite(
  path: string,
  operation: () => Promise<void>
): Promise<void> {
  // Windows case aliases must share rotation/append ownership. Keep the actual
  // I/O path unchanged; case-sensitive Windows directories only serialize more.
  const queueKey = process.platform === "win32" ? path.toLowerCase() : path;
  const previous = processWriteQueues.get(queueKey) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  processWriteQueues.set(queueKey, tail);

  try {
    await current;
  } finally {
    if (processWriteQueues.get(queueKey) === tail) {
      processWriteQueues.delete(queueKey);
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

export function createLockOptions(
  options: FileAuditSinkOptions,
  auditPath: string | URL
): LockOptions | undefined {
  if (options.staleLockMs !== undefined) {
    throw new TypeError(
      "staleLockMs is unsupported: stop writers before recovering an abandoned lock."
    );
  }
  if (options.lock !== true) {
    return undefined;
  }

  const timeoutMs = options.lockTimeoutMs ?? 5000;
  assertNonNegativeInteger(timeoutMs, "lockTimeoutMs");

  return {
    path: `${toPathString(auditPath)}.lock`,
    timeoutMs,
    staleMs: undefined,
    retryMs: 20
  };
}

export async function withFileLock(
  lock: LockOptions,
  operation: () => Promise<void>
): Promise<void> {
  const release = await acquireFileLock(lock);

  await withAuditCleanup(operation, release, "Audit operation and lock release failed.");
}

type LockRecordWriter = (handle: FileHandle, contents: string) => Promise<void>;

export async function acquireFileLock(
  lock: LockOptions,
  writeLockRecord: LockRecordWriter = defaultWriteLockRecord
): Promise<() => Promise<void>> {
  if (lock.staleMs !== undefined)
    throw new TypeError("Automatic stale lock takeover is unsupported.");
  const startedAt = performance.now();

  while (true) {
    let handle: FileHandle;
    try {
      handle = await open(lock.path, "wx");
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (performance.now() - startedAt >= lock.timeoutMs)
        throw new Error(`Timed out acquiring audit file lock: ${lock.path}`);
      await delay(lock.retryMs);
      continue;
    }
    const ownerToken = randomUUID();
    let identity: BigIntStats | undefined;
    const release = (allowIncomplete = false) =>
      withAuditCleanup(
        () => handle.close(),
        () => removeLockIfOwned(lock.path, ownerToken, identity, allowIncomplete),
        "Audit lock close and owned-marker cleanup failed."
      );
    try {
      identity = await handle.stat({ bigint: true });
      await writeLockRecord(handle, `${ownerToken}\n${process.pid}\n${new Date().toISOString()}\n`);
    } catch (error) {
      // Initialization errors are not lock contention and must never be retried.
      await withAuditCleanup(
        async () => {
          throw error;
        },
        () => release(true),
        "Audit lock initialization and cleanup failed."
      );
      throw error;
    }
    return () => release();
  }
}

async function defaultWriteLockRecord(handle: FileHandle, contents: string): Promise<void> {
  await handle.writeFile(contents, "utf8");
}

async function removeLockIfOwned(
  path: string,
  ownerToken: string,
  expected: BigIntStats | undefined,
  allowIncomplete = false
): Promise<void> {
  try {
    if (expected === undefined) return;
    const current = await lstat(path, { bigint: true });
    if (!current.isFile() || current.dev !== expected.dev || current.ino !== expected.ino) return;
    if (!allowIncomplete) {
      const contents = await readFile(path, "utf8");
      if (contents.split("\n", 1)[0] !== ownerToken) return;
    }
    // A failed write may leave any prefix, not just an empty marker. Its acquired
    // file identity is the ownership evidence; a different marker is preserved.
    await removeIfExists(path);
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
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
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
