import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
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
  const watcher = watch(watcherPath, { persistent: options.persistent ?? false }, () => {
    if (closed) {
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      reloadQueue = reloadQueue
        .then(async () => {
          await reload();
        })
        .catch((error: unknown) => {
          options.onError?.(error);
        });
    }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  });

  async function reload(): Promise<FlagSnapshot> {
    const snapshot = await loadFlagSnapshotFile(options.path, options);
    await options.onSnapshot(snapshot);
    currentSnapshot = snapshot;
    return snapshot;
  }

  try {
    await reload();
  } catch (error) {
    closeWatcher(watcher, timer);
    throw error;
  }

  return {
    path: watcherPath,
    getSnapshot() {
      return currentSnapshot;
    },
    reload,
    close() {
      closed = true;
      closeWatcher(watcher, timer);
      timer = undefined;
    }
  };
}

function resolveSnapshotFileFormat(
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

function closeWatcher(watcher: FSWatcher, timer: ReturnType<typeof setTimeout> | undefined): void {
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  watcher.close();
}
