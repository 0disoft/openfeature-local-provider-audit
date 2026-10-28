import { AsyncLocalStorage } from "node:async_hooks";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import {
  watch,
  watchFile,
  statSync,
  constants,
  type FSWatcher,
  type BigIntStats,
  type Stats,
  unwatchFile,
  type WatchListener
} from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { cleanupResource, cleanupResources } from "../errors/resource-cleanup.js";
import type {
  FlagSnapshot,
  FlagSnapshotFileWatcher,
  LoadFlagSnapshotFileOptions,
  SnapshotFileFormat,
  WatchFlagSnapshotFileOptions
} from "../public-types.js";
import { parseJsonFlagSnapshot } from "./parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "./parse-yaml-snapshot.js";

const DEFAULT_DEBOUNCE_MS = 50;
const MAX_DEBOUNCE_MS = 2_147_483_647;
const DEFAULT_MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const MIN_POLL_INTERVAL_MS = 50;
const SNAPSHOT_READ_CHUNK_BYTES = 64 * 1024;
const snapshotCallbackContext = new AsyncLocalStorage<{
  readonly watcher: object;
  active: boolean;
}>();

interface SnapshotFileTarget {
  readonly directory: string;
  readonly fileName: string;
  readonly path: string;
}

interface SnapshotWatchHandle {
  close(): void;
}

type SnapshotWatchFileListener = (current: Stats, previous: Stats) => void;

interface SnapshotWatchRuntime {
  readonly platform: NodeJS.Platform;
  statFile(path: string): Pick<Stats, "isFile">;
  watch(
    path: string,
    options: { readonly persistent: boolean },
    listener: WatchListener<string>
  ): FSWatcher;
  watchFile(
    path: string,
    options: {
      readonly bigint: false;
      readonly persistent: boolean;
      readonly interval: number;
    },
    listener: SnapshotWatchFileListener
  ): void;
  unwatchFile(path: string, listener: SnapshotWatchFileListener): void;
}

interface SnapshotWatchOptions {
  readonly path: string | URL;
  readonly target: SnapshotFileTarget;
  readonly persistent: boolean;
  readonly debounceMs: number;
  readonly consistencyPollIntervalMs?: number;
  readonly onChange: () => void;
  readonly onError: (error: unknown) => void;
}

const DEFAULT_SNAPSHOT_WATCH_RUNTIME: SnapshotWatchRuntime = {
  platform: process.platform,
  statFile: statSync,
  watch(path, options, listener) {
    return watch(path, options, listener);
  },
  watchFile(path, options, listener) {
    watchFile(path, options, listener);
  },
  unwatchFile(path, listener) {
    unwatchFile(path, listener);
  }
};

export async function loadFlagSnapshotFile(
  path: string | URL,
  options: LoadFlagSnapshotFileOptions = {}
): Promise<FlagSnapshot> {
  // Capture caller-owned URL/options without changing native string-path resolution.
  const filePath = typeof path === "string" ? path : fileURLToPath(path);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SNAPSHOT_FILE_BYTES;
  const encoding = options.encoding ?? "utf8";
  const format = options.format ?? "auto";
  const text = await readFileWithinLimit(filePath, maxBytes, encoding);
  return parseSnapshotFileText(text, filePath, format);
}

function parseSnapshotFileText(
  text: string,
  path: string | URL,
  inputFormat: SnapshotFileFormat
): FlagSnapshot {
  const format = resolveSnapshotFileFormat(path, inputFormat);

  if (format === "json") {
    return parseJsonFlagSnapshot(text);
  }

  return parseYamlFlagSnapshot(text);
}

export async function watchFlagSnapshotFile(
  options: WatchFlagSnapshotFileOptions
): Promise<FlagSnapshotFileWatcher> {
  let currentSnapshot: FlagSnapshot | undefined;
  let currentSerializedSnapshot: string | undefined;
  let currentInputHash: string | undefined;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reloadQueue = Promise.resolve();
  const callbackOwner = {};
  let queuedReload:
    | {
        request: { reportError: boolean; skipUnchanged: boolean };
        promise: Promise<FlagSnapshot>;
      }
    | undefined;

  const inputPath = options.path;
  const watcherPath = typeof inputPath === "string" ? inputPath : new URL(inputPath.href);
  const target = resolveSnapshotFileTarget(watcherPath);
  const loadOptions: LoadFlagSnapshotFileOptions = {
    format: options.format ?? "auto",
    encoding: options.encoding ?? "utf8",
    maxBytes: options.maxBytes ?? DEFAULT_MAX_SNAPSHOT_FILE_BYTES
  };
  const onSnapshot = options.onSnapshot.bind(options);
  const onError = options.onError?.bind(options);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  assertOptionalPollInterval(options.consistencyPollIntervalMs);
  const watcher = createSnapshotWatchHandle({
    path: watcherPath,
    target,
    persistent: options.persistent ?? false,
    debounceMs,
    ...(options.consistencyPollIntervalMs !== undefined
      ? { consistencyPollIntervalMs: options.consistencyPollIntervalMs }
      : {}),
    onChange() {
      if (closed) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        void enqueueReload({ reportError: true, skipUnchanged: true }).catch(() => undefined);
      }, debounceMs);
    },
    onError(error) {
      if (closed) {
        return;
      }
      void reportReloadError(error);
    }
  });

  async function performReload(skipUnchanged: boolean): Promise<FlagSnapshot> {
    if (closed) {
      if (currentSnapshot !== undefined) return currentSnapshot;
      throw new LocalProviderError("PROVIDER_NOT_READY", "Snapshot watcher is closed.");
    }
    const text = await readFileWithinLimit(
      target.path,
      loadOptions.maxBytes ?? DEFAULT_MAX_SNAPSHOT_FILE_BYTES,
      loadOptions.encoding ?? "utf8"
    );
    // Hash UTF-16 code units without UTF-8 replacement of lone legacy surrogates.
    // File safety/encoding checks still run; only accepted automatic repeats skip parsing.
    const inputHash = createHash("sha256").update(text, "utf16le").digest("hex");
    if (skipUnchanged && inputHash === currentInputHash && currentSnapshot !== undefined) {
      return currentSnapshot;
    }
    const snapshot = parseSnapshotFileText(text, target.path, loadOptions.format ?? "auto");
    const serializedSnapshot = JSON.stringify(snapshot);
    if (skipUnchanged && serializedSnapshot === currentSerializedSnapshot) {
      currentInputHash = inputHash;
      return snapshot;
    }
    if (closed) {
      return snapshot;
    }
    const callback = { watcher: callbackOwner, active: true };
    try {
      await snapshotCallbackContext.run(callback, () => onSnapshot(snapshot));
    } finally {
      callback.active = false;
    }
    if (closed) {
      return snapshot;
    }
    currentSnapshot = snapshot;
    currentSerializedSnapshot = serializedSnapshot;
    currentInputHash = inputHash;
    return snapshot;
  }

  function enqueueReload({
    reportError,
    skipUnchanged
  }: {
    readonly reportError: boolean;
    readonly skipUnchanged: boolean;
  }): Promise<FlagSnapshot> {
    if (closed) return performReload(skipUnchanged);
    if (queuedReload !== undefined) {
      queuedReload.request.reportError ||= reportError;
      queuedReload.request.skipUnchanged &&= skipUnchanged;
      return queuedReload.promise;
    }
    const request = { reportError, skipUnchanged };
    const reload = reloadQueue.then(() => {
      queuedReload = undefined;
      return performReload(request.skipUnchanged);
    });
    queuedReload = { request, promise: reload };
    reloadQueue = reload.then(
      () => undefined,
      (error: unknown) => {
        if (request.reportError) {
          // Recovery callbacks may await reload(); they cannot own the reload queue.
          void reportReloadError(error);
        }
      }
    );
    return reload;
  }

  async function reportReloadError(error: unknown): Promise<void> {
    try {
      await onError?.(error);
    } catch {
      // Error reporting must not poison the reload queue.
    }
  }

  try {
    await enqueueReload({ reportError: false, skipUnchanged: false });
  } catch (error) {
    closed = true;
    cleanupResources([() => closeWatcher(watcher, timer)], "Snapshot startup and cleanup failed.", {
      cause: error
    });
    throw error;
  }

  return {
    get path() {
      return typeof watcherPath === "string" ? watcherPath : new URL(watcherPath.href);
    },
    getSnapshot() {
      return currentSnapshot;
    },
    reload() {
      const callback = snapshotCallbackContext.getStore();
      if (!closed && callback?.watcher === callbackOwner && callback.active) {
        return Promise.reject(
          new LocalProviderError(
            "PROVIDER_NOT_READY",
            "Cannot reload a snapshot watcher from its active onSnapshot callback."
          )
        );
      }
      return enqueueReload({ reportError: false, skipUnchanged: false });
    },
    close() {
      closed = true;
      closeWatcher(watcher, timer);
      timer = undefined;
    }
  };
}

export async function readFileWithinLimit(
  path: string | URL,
  maxBytes: number,
  encoding: BufferEncoding
): Promise<string> {
  assertPositiveInteger(maxBytes, "maxBytes");
  // Follow regular symlink targets (including projected volumes), but never wait
  // for a FIFO peer. Recheck the opened handle in case the target changed.
  assertRegularSnapshotFile(await stat(path));
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  let failure: { cause: unknown } | undefined;
  try {
    const fileStats = await handle.stat({ bigint: true });
    assertRegularSnapshotFile(fileStats);
    assertSnapshotSizeWithinLimit(Number(fileStats.size), maxBytes);

    // Reserve one probe byte; repeated short reads fill the same bounded buffer.
    let buffer = Buffer.allocUnsafe(Number(fileStats.size) + 1);
    let totalBytes = 0;

    while (true) {
      if (totalBytes === buffer.length) {
        const expanded = Buffer.allocUnsafe(Math.min(maxBytes + 1, buffer.length * 2));
        buffer.copy(expanded, 0, 0, totalBytes);
        buffer = expanded;
      }
      const { bytesRead } = await handle.read(
        buffer,
        totalBytes,
        Math.min(SNAPSHOT_READ_CHUNK_BYTES, buffer.length - totalBytes),
        null
      );
      if (bytesRead === 0) {
        assertSnapshotFileUnchanged(fileStats, await handle.stat({ bigint: true }));
        const contents = buffer.subarray(0, totalBytes);
        if ((encoding === "utf8" || encoding === "utf-8") && !isUtf8(contents)) {
          throw new LocalProviderError(
            LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
            "Flag snapshot file must contain valid UTF-8."
          );
        }
        return contents.toString(encoding);
      }

      totalBytes += bytesRead;
      assertSnapshotSizeWithinLimit(totalBytes, maxBytes);
    }
  } catch (error) {
    failure = { cause: error };
    throw error;
  } finally {
    await cleanupResource(() => handle.close(), failure, "Snapshot file read and close failed.");
  }
}

function assertSnapshotFileUnchanged(before: BigIntStats, after: BigIntStats): void {
  // Unlinking an atomically replaced inode can change ctime without changing its bytes.
  if (
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    (before.ctimeNs === after.ctimeNs || after.nlink === 0n)
  )
    return;
  throw new LocalProviderError(
    LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
    "Flag snapshot file changed during read; retry explicitly."
  );
}

function assertRegularSnapshotFile(stats: Pick<Stats, "isFile">): void {
  if (!stats.isFile()) {
    throw new LocalProviderError(
      LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
      "Flag snapshot path must resolve to a regular file."
    );
  }
}

function assertSnapshotSizeWithinLimit(actualBytes: number, maxBytes: number): void {
  if (actualBytes > maxBytes) {
    throw new LocalProviderError(
      LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
      `Flag snapshot file exceeds maxBytes (${maxBytes}).`
    );
  }
}

export function resolveSnapshotFileFormat(
  path: string | URL,
  format: SnapshotFileFormat
): "json" | "yaml" {
  if (format === "json" || format === "yaml") {
    return format;
  }

  const extension = extname(typeof path === "string" ? path : fileURLToPath(path)).toLowerCase();
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }

  throw new LocalProviderError(
    LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
    "Flag snapshot file format could not be detected."
  );
}

function resolveSnapshotFileTarget(path: string | URL): SnapshotFileTarget {
  const filePath = resolve(typeof path === "string" ? path : fileURLToPath(path));

  return {
    directory: dirname(filePath),
    fileName: basename(filePath),
    path: filePath
  };
}

export function createSnapshotWatchHandle(
  options: SnapshotWatchOptions,
  runtime: SnapshotWatchRuntime = DEFAULT_SNAPSHOT_WATCH_RUNTIME
): SnapshotWatchHandle {
  if (
    !Number.isInteger(options.debounceMs) ||
    options.debounceMs < 0 ||
    options.debounceMs > MAX_DEBOUNCE_MS
  ) {
    throw new RangeError(`debounceMs must be an integer between 0 and ${MAX_DEBOUNCE_MS}`);
  }
  assertOptionalPollInterval(options.consistencyPollIntervalMs);

  if (runtime.platform === "win32") {
    let closed = false;
    const listener = createSnapshotWatchFileListener(() => {
      if (!closed) {
        options.onChange();
      }
    });

    runtime.watchFile(
      options.target.path,
      {
        bigint: false,
        persistent: options.persistent,
        interval:
          options.consistencyPollIntervalMs ?? Math.max(options.debounceMs, MIN_POLL_INTERVAL_MS)
      },
      listener
    );

    return {
      close() {
        if (closed) {
          return;
        }
        closed = true;
        runtime.unwatchFile(options.target.path, listener);
      }
    };
  }

  let handleClosed = false;
  let fileWatcher: FSWatcher | undefined;

  const directoryWatcher = createNativeWatcher(
    options.target.directory,
    options,
    runtime,
    (eventType, fileName) => {
      if (handleClosed) {
        return;
      }
      if (
        fileName !== null &&
        fileName !== undefined &&
        fileName.toString() !== options.target.fileName
      ) {
        return;
      }
      if (runtime.platform === "darwin" && eventType === "rename") {
        rearmMacOsFileWatcher();
      }
      options.onChange();
    }
  );

  if (runtime.platform !== "darwin") {
    return addConsistencyPolling(
      {
        close() {
          if (handleClosed) {
            return;
          }
          handleClosed = true;
          directoryWatcher.close();
        }
      },
      options,
      runtime
    );
  }

  try {
    fileWatcher = createMacOsFileWatcher();
  } catch (error) {
    handleClosed = true;
    cleanupResources(
      [directoryWatcher.close.bind(directoryWatcher)],
      "Snapshot watcher setup and cleanup failed.",
      { cause: error }
    );
    throw error;
  }

  return addConsistencyPolling(
    {
      close() {
        if (handleClosed) return;
        handleClosed = true;
        const previous = fileWatcher;
        fileWatcher = undefined;
        const cleanups = [directoryWatcher.close.bind(directoryWatcher)];
        if (previous !== undefined) cleanups.push(previous.close.bind(previous));
        cleanupResources(cleanups, "Snapshot watcher cleanup failed.");
      }
    },
    options,
    runtime
  );

  function rearmMacOsFileWatcher(): void {
    try {
      const nextFileWatcher = createMacOsFileWatcher();
      const previousFileWatcher = fileWatcher;
      fileWatcher = nextFileWatcher;
      previousFileWatcher?.close();
    } catch (error) {
      options.onError(error);
    }
  }

  function createMacOsFileWatcher(): FSWatcher {
    // Native macOS registration can block on a FIFO before the async loader runs.
    // Check synchronously at both registration sites; regular symlink targets remain valid.
    assertRegularSnapshotFile(runtime.statFile(options.target.path));
    return createNativeWatcher(options.target.path, options, runtime, () => {
      if (!handleClosed) options.onChange();
    });
  }
}

function addConsistencyPolling(
  nativeHandle: SnapshotWatchHandle,
  options: SnapshotWatchOptions,
  runtime: SnapshotWatchRuntime
): SnapshotWatchHandle {
  const interval = options.consistencyPollIntervalMs;
  if (interval === undefined) {
    return nativeHandle;
  }

  let closed = false;
  const listener = createSnapshotWatchFileListener(() => {
    if (!closed) {
      options.onChange();
    }
  });

  try {
    runtime.watchFile(
      options.target.path,
      {
        bigint: false,
        persistent: options.persistent,
        interval
      },
      listener
    );
  } catch (error) {
    cleanupResources(
      [nativeHandle.close.bind(nativeHandle)],
      "Snapshot polling setup and cleanup failed.",
      { cause: error }
    );
    throw error;
  }

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      cleanupResources(
        [
          () => runtime.unwatchFile(options.target.path, listener),
          nativeHandle.close.bind(nativeHandle)
        ],
        "Snapshot polling and native cleanup failed."
      );
    }
  };
}

function createSnapshotWatchFileListener(onChange: () => void): SnapshotWatchFileListener {
  return (current, previous) => {
    if (haveSameSnapshotFileFingerprint(current, previous)) {
      return;
    }
    onChange();
  };
}

function haveSameSnapshotFileFingerprint(current: Stats, previous: Stats): boolean {
  return (
    current.dev === previous.dev &&
    current.ino === previous.ino &&
    current.mtimeMs === previous.mtimeMs &&
    current.ctimeMs === previous.ctimeMs &&
    current.size === previous.size
  );
}

function createNativeWatcher(
  path: string,
  options: SnapshotWatchOptions,
  runtime: SnapshotWatchRuntime,
  listener: WatchListener<string>
): FSWatcher {
  const watcher = runtime.watch(path, { persistent: options.persistent }, listener);
  watcher.on("error", options.onError);
  return watcher;
}

function closeWatcher(
  watcher: SnapshotWatchHandle,
  timer: ReturnType<typeof setTimeout> | undefined
): void {
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  watcher.close();
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertOptionalPollInterval(value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < MIN_POLL_INTERVAL_MS) {
    throw new RangeError(
      `consistencyPollIntervalMs must be an integer greater than or equal to ${MIN_POLL_INTERVAL_MS}`
    );
  }
}
