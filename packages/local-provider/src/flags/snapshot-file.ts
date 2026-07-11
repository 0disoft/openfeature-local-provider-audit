import { watch, watchFile, type FSWatcher, type Stats, unwatchFile } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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

interface SnapshotFileTarget {
  readonly directory: string;
  readonly fileName: string;
  readonly path: string;
}

type SnapshotWatchHandle =
  | {
      readonly type: "fs-watch";
      readonly watchers: readonly FSWatcher[];
    }
  | {
      readonly type: "fs-watch-file";
      readonly path: string;
      readonly listener: SnapshotWatchFileListener;
    };

type SnapshotWatchFileListener = (current: Stats, previous: Stats) => void;

interface SnapshotWatchOptions {
  readonly path: string | URL;
  readonly target: SnapshotFileTarget;
  readonly persistent: boolean;
  readonly debounceMs: number;
  readonly onChange: () => void;
}

export async function loadFlagSnapshotFile(
  path: string | URL,
  options: LoadFlagSnapshotFileOptions = {}
): Promise<FlagSnapshot> {
  await assertFileSizeWithinLimit(path, options.maxBytes ?? DEFAULT_MAX_SNAPSHOT_FILE_BYTES);
  const text = await readFile(path, options.encoding ?? "utf8");
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
        void enqueueReload({ reportError: true }).catch(() => undefined);
      }, debounceMs);
    }
  });

  async function performReload(): Promise<FlagSnapshot> {
    const snapshot = await loadFlagSnapshotFile(options.path, options);
    if (closed) {
      return snapshot;
    }
    await options.onSnapshot(snapshot);
    if (closed) {
      return snapshot;
    }
    currentSnapshot = snapshot;
    return snapshot;
  }

  function enqueueReload({
    reportError
  }: {
    readonly reportError: boolean;
  }): Promise<FlagSnapshot> {
    const reload = reloadQueue.then(() => performReload());
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
    await enqueueReload({ reportError: false });
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
      return enqueueReload({ reportError: false });
    },
    close() {
      closed = true;
      closeWatcher(watcher, timer);
      timer = undefined;
    }
  };
}

async function assertFileSizeWithinLimit(path: string | URL, maxBytes: number): Promise<void> {
  assertPositiveInteger(maxBytes, "maxBytes");

  const fileStats = await stat(path);
  if (fileStats.size > maxBytes) {
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

function createSnapshotWatchHandle(options: SnapshotWatchOptions): SnapshotWatchHandle {
  if (process.platform === "win32") {
    const listener: SnapshotWatchFileListener = (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) {
        return;
      }
      options.onChange();
    };

    watchFile(
      options.target.path,
      {
        bigint: false,
        persistent: options.persistent,
        interval: Math.max(options.debounceMs, MIN_WINDOWS_POLL_INTERVAL_MS)
      },
      listener
    );

    return {
      type: "fs-watch-file",
      path: options.target.path,
      listener
    };
  }

  const directoryWatcher = watch(
    options.target.directory,
    { persistent: options.persistent },
    (_eventType, fileName) => {
      if (
        fileName !== null &&
        fileName !== undefined &&
        fileName.toString() !== options.target.fileName
      ) {
        return;
      }
      options.onChange();
    }
  );

  if (process.platform !== "darwin") {
    return {
      type: "fs-watch",
      watchers: [directoryWatcher]
    };
  }

  try {
    const fileWatcher = watch(options.target.path, { persistent: options.persistent }, () => {
      options.onChange();
    });

    return {
      type: "fs-watch",
      watchers: [directoryWatcher, fileWatcher]
    };
  } catch (error) {
    directoryWatcher.close();
    throw error;
  }
}

function closeWatcher(
  watcher: SnapshotWatchHandle,
  timer: ReturnType<typeof setTimeout> | undefined
): void {
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  if (watcher.type === "fs-watch") {
    for (const nativeWatcher of watcher.watchers) {
      nativeWatcher.close();
    }
    return;
  }
  unwatchFile(watcher.path, watcher.listener);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
