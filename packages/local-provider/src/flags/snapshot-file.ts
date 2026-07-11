import {
  watch,
  watchFile,
  type FSWatcher,
  type Stats,
  unwatchFile,
  type WatchListener
} from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
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
const DEFAULT_MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const MIN_WINDOWS_POLL_INTERVAL_MS = 50;
const SNAPSHOT_READ_CHUNK_BYTES = 64 * 1024;

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
  readonly onChange: () => void;
  readonly onError: (error: unknown) => void;
}

const DEFAULT_SNAPSHOT_WATCH_RUNTIME: SnapshotWatchRuntime = {
  platform: process.platform,
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
  const text = await readFileWithinLimit(
    path,
    options.maxBytes ?? DEFAULT_MAX_SNAPSHOT_FILE_BYTES,
    options.encoding ?? "utf8"
  );
  const format = resolveSnapshotFileFormat(path, options.format ?? "auto");

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
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reloadQueue = Promise.resolve();

  const watcherPath = options.path;
  const target = resolveSnapshotFileTarget(watcherPath);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watcher = createSnapshotWatchHandle({
    path: watcherPath,
    target,
    persistent: options.persistent ?? false,
    debounceMs,
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
    const snapshot = await loadFlagSnapshotFile(options.path, options);
    const serializedSnapshot = JSON.stringify(snapshot);
    if (skipUnchanged && serializedSnapshot === currentSerializedSnapshot) {
      return snapshot;
    }
    if (closed) {
      return snapshot;
    }
    await options.onSnapshot(snapshot);
    if (closed) {
      return snapshot;
    }
    currentSnapshot = snapshot;
    currentSerializedSnapshot = serializedSnapshot;
    return snapshot;
  }

  function enqueueReload({
    reportError,
    skipUnchanged
  }: {
    readonly reportError: boolean;
    readonly skipUnchanged: boolean;
  }): Promise<FlagSnapshot> {
    const reload = reloadQueue.then(() => performReload(skipUnchanged));
    reloadQueue = reload.then(
      () => undefined,
      async (error: unknown) => {
        if (reportError) {
          await reportReloadError(error);
        }
      }
    );
    return reload;
  }

  async function reportReloadError(error: unknown): Promise<void> {
    try {
      await options.onError?.(error);
    } catch {
      // Error reporting must not poison the reload queue.
    }
  }

  try {
    await enqueueReload({ reportError: false, skipUnchanged: false });
  } catch (error) {
    closeWatcher(watcher, timer);
    throw error;
  }

  return {
    path: watcherPath,
    getSnapshot() {
      return currentSnapshot;
    },
    reload() {
      return enqueueReload({ reportError: false, skipUnchanged: false });
    },
    close() {
      closed = true;
      closeWatcher(watcher, timer);
      timer = undefined;
    }
  };
}

async function readFileWithinLimit(
  path: string | URL,
  maxBytes: number,
  encoding: BufferEncoding
): Promise<string> {
  assertPositiveInteger(maxBytes, "maxBytes");
  const handle = await open(path, "r");

  try {
    const fileStats = await handle.stat();
    assertSnapshotSizeWithinLimit(fileStats.size, maxBytes);

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (true) {
      const remainingBytes = maxBytes - totalBytes + 1;
      const buffer = Buffer.allocUnsafe(Math.min(SNAPSHOT_READ_CHUNK_BYTES, remainingBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        return Buffer.concat(chunks, totalBytes).toString(encoding);
      }

      totalBytes += bytesRead;
      assertSnapshotSizeWithinLimit(totalBytes, maxBytes);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    await handle.close();
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
  const filePath = typeof path === "string" ? path : fileURLToPath(path);

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
  if (runtime.platform === "win32") {
    const listener: SnapshotWatchFileListener = (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) {
        return;
      }
      options.onChange();
    };

    runtime.watchFile(
      options.target.path,
      {
        bigint: false,
        persistent: options.persistent,
        interval: Math.max(options.debounceMs, MIN_WINDOWS_POLL_INTERVAL_MS)
      },
      listener
    );

    return {
      close() {
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
    return {
      close() {
        if (handleClosed) {
          return;
        }
        handleClosed = true;
        directoryWatcher.close();
      }
    };
  }

  try {
    fileWatcher = createNativeWatcher(options.target.path, options, runtime, () => {
      options.onChange();
    });

    return {
      close() {
        if (handleClosed) {
          return;
        }
        handleClosed = true;
        directoryWatcher.close();
        fileWatcher?.close();
        fileWatcher = undefined;
      }
    };
  } catch (error) {
    handleClosed = true;
    directoryWatcher.close();
    throw error;
  }

  function rearmMacOsFileWatcher(): void {
    try {
      const nextFileWatcher = createNativeWatcher(options.target.path, options, runtime, () => {
        options.onChange();
      });
      const previousFileWatcher = fileWatcher;
      fileWatcher = nextFileWatcher;
      previousFileWatcher?.close();
    } catch (error) {
      options.onError(error);
    }
  }
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
