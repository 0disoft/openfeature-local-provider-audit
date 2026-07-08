import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
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

interface SnapshotFileTarget {
  readonly directory: string;
  readonly fileName: string;
}

export async function loadFlagSnapshotFile(
  path: string | URL,
  options: LoadFlagSnapshotFileOptions = {}
): Promise<FlagSnapshot> {
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
  const watcher = watch(
    target.directory,
    { persistent: options.persistent ?? false },
    (_eventType, fileName) => {
      if (closed) {
        return;
      }
      if (fileName !== null && fileName !== undefined && fileName.toString() !== target.fileName) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        void enqueueReload({ reportError: true }).catch(() => undefined);
      }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    }
  );

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
    fileName: basename(filePath)
  };
}

function closeWatcher(watcher: FSWatcher, timer: ReturnType<typeof setTimeout> | undefined): void {
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  watcher.close();
}
