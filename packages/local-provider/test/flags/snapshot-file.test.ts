import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { isLocalProviderError } from "../../src/errors/local-provider-error.js";
import { loadFlagSnapshotFile, watchFlagSnapshotFile } from "../../src/flags/snapshot-file.js";
import type { FlagSnapshot } from "../../src/public-types.js";

describe("snapshot file helpers", () => {
  it("loads JSON snapshots by extension", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");

      const snapshot = await loadFlagSnapshotFile(path);

      expect(getCheckoutDefaultEnabled(snapshot)).toBe(true);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("loads YAML snapshots by extension", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.yaml");
      await writeFile(path, createYamlSnapshot(true), "utf8");

      const snapshot = await loadFlagSnapshotFile(path);

      expect(getCheckoutDefaultEnabled(snapshot)).toBe(true);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rejects unknown extensions in auto mode", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.txt");
      await writeFile(path, createJsonSnapshot(true), "utf8");

      await expectLocalProviderError(
        loadFlagSnapshotFile(path),
        LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR
      );
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("manually reloads watched snapshots", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");
      const snapshots: boolean[] = [];

      const watcher = await watchFlagSnapshotFile({
        path,
        onSnapshot(snapshot) {
          snapshots.push(getCheckoutDefaultEnabled(snapshot));
        }
      });

      await writeFile(path, createJsonSnapshot(false), "utf8");
      const reloaded = await watcher.reload();
      watcher.close();

      expect(getCheckoutDefaultEnabled(reloaded)).toBe(false);
      expect(snapshots).toEqual([true, false]);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("reloads watched snapshots after file change events", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");
      const snapshots: boolean[] = [];

      const watcher = await watchFlagSnapshotFile({
        path,
        debounceMs: 10,
        onSnapshot(snapshot) {
          snapshots.push(getCheckoutDefaultEnabled(snapshot));
        }
      });

      await writeFile(path, createJsonSnapshot(false), "utf8");
      await waitFor(() => snapshots.length >= 2);
      watcher.close();

      expect(snapshots.at(-1)).toBe(false);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("continues watching after atomic file replacement", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");
      const snapshots: boolean[] = [];

      const watcher = await watchFlagSnapshotFile({
        path,
        debounceMs: 10,
        onSnapshot(snapshot) {
          snapshots.push(getCheckoutDefaultEnabled(snapshot));
        }
      });

      await writeFile(join(tempDirectory, "flags-next.json"), createJsonSnapshot(false), "utf8");
      await rename(join(tempDirectory, "flags-next.json"), path);
      await waitFor(() => snapshots.at(-1) === false);

      await writeFile(join(tempDirectory, "flags-next.json"), createJsonSnapshot(true), "utf8");
      await rename(join(tempDirectory, "flags-next.json"), path);
      await waitFor(() => snapshots.length >= 3 && snapshots.at(-1) === true);
      watcher.close();

      expect(snapshots).toEqual([true, false, true]);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("reports reload errors without replacing the last valid snapshot", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");
      const onError = vi.fn();

      const watcher = await watchFlagSnapshotFile({
        path,
        debounceMs: 10,
        onSnapshot() {
          return undefined;
        },
        onError
      });

      await writeFile(path, "{", "utf8");

      await expectLocalProviderError(watcher.reload(), LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      await waitFor(() => onError.mock.calls.length > 0);

      const currentSnapshot = watcher.getSnapshot();
      expect(
        currentSnapshot === undefined ? undefined : getCheckoutDefaultEnabled(currentSnapshot)
      ).toBe(true);
      watcher.close();
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the reload queue alive when onError throws", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");
      const snapshots: boolean[] = [];
      const onError = vi.fn(() => {
        throw new Error("logger failed");
      });

      const watcher = await watchFlagSnapshotFile({
        path,
        debounceMs: 10,
        onSnapshot(snapshot) {
          snapshots.push(getCheckoutDefaultEnabled(snapshot));
        },
        onError
      });

      await writeFile(path, "{", "utf8");
      await waitFor(() => onError.mock.calls.length > 0);

      await writeFile(path, createJsonSnapshot(false), "utf8");
      await waitFor(() => snapshots.at(-1) === false);
      watcher.close();

      expect(snapshots).toEqual([true, false]);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

function createJsonSnapshot(enabled: boolean): string {
  return JSON.stringify({
    schemaVersion: 1,
    flags: {
      "checkout.enabled": {
        type: "boolean",
        defaultVariant: enabled ? "on" : "off",
        variants: {
          on: true,
          off: false
        }
      }
    }
  });
}

function getCheckoutDefaultEnabled(snapshot: FlagSnapshot): boolean {
  const flag = snapshot.flags["checkout.enabled"];
  if (flag === undefined) {
    throw new Error("Missing checkout.enabled flag.");
  }

  return flag.variants[flag.defaultVariant] === true;
}

function createYamlSnapshot(enabled: boolean): string {
  return `
schemaVersion: 1
flags:
  checkout.enabled:
    type: boolean
    defaultVariant: "${enabled ? "on" : "off"}"
    variants:
      "on": true
      "off": false
`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function expectLocalProviderError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isLocalProviderError(error)).toBe(true);
    if (isLocalProviderError(error)) {
      expect(error.code).toBe(code);
    }
    return;
  }

  throw new Error("Expected promise to reject with LocalProviderError.");
}
