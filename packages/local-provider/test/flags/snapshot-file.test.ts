import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { isLocalProviderError } from "../../src/errors/local-provider-error.js";
import { loadFlagSnapshotFile, watchFlagSnapshotFile } from "../../src/flags/snapshot-file.js";
import type { FlagSnapshot } from "../../src/public-types.js";

const WATCH_STARTUP_STRESS_ITERATIONS = 8;

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

  it("rejects snapshot files larger than maxBytes before parsing", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");

      await expectLocalProviderError(
        loadFlagSnapshotFile(path, { maxBytes: 1 }),
        LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR
      );
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("accepts a snapshot file exactly at the maxBytes boundary", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      const snapshotJson = createJsonSnapshot(true);
      await writeFile(path, snapshotJson, "utf8");

      const snapshot = await loadFlagSnapshotFile(path, {
        maxBytes: Buffer.byteLength(snapshotJson, "utf8")
      });

      expect(getCheckoutDefaultEnabled(snapshot)).toBe(true);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rejects non-positive maxBytes limits", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");

      await expect(loadFlagSnapshotFile(path, { maxBytes: 0 })).rejects.toThrow(
        "maxBytes must be a positive integer"
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

      const unchanged = await watcher.reload();
      vi.useFakeTimers();
      try {
        await writeFile(path, createJsonSnapshot(false), "utf8");
        const reloaded = await watcher.reload();

        expect(getCheckoutDefaultEnabled(unchanged)).toBe(true);
        expect(getCheckoutDefaultEnabled(reloaded)).toBe(false);
        expect(snapshots).toEqual([true, true, false]);
      } finally {
        watcher.close();
        vi.useRealTimers();
      }
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("reloads watched snapshots after file change events", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-file-"));
    try {
      for (let iteration = 0; iteration < WATCH_STARTUP_STRESS_ITERATIONS; iteration += 1) {
        const path = join(tempDirectory, `flags-${iteration}.json`);
        await writeFile(path, createJsonSnapshot(true), "utf8");
        const snapshots: boolean[] = [];
        const watcher = await watchFlagSnapshotFile({
          path,
          debounceMs: 10,
          onSnapshot(snapshot) {
            snapshots.push(getCheckoutDefaultEnabled(snapshot));
          }
        });

        try {
          await writeFile(path, createJsonSnapshot(false), "utf8");
          await waitFor(() => snapshots.at(-1) === false);

          expect(snapshots[0]).toBe(true);
          expect(snapshots.at(-1)).toBe(false);
        } finally {
          watcher.close();
        }
      }
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

      await writeFile(path, createJsonSnapshot(true), "utf8");
      await waitFor(() => snapshots.length >= 3 && snapshots.at(-1) === true);

      await writeFile(join(tempDirectory, "flags-next.json"), createJsonSnapshot(false), "utf8");
      await rename(join(tempDirectory, "flags-next.json"), path);
      await waitFor(() => snapshots.length >= 4 && snapshots.at(-1) === false);
      watcher.close();

      expect(snapshots).toEqual([true, false, true, false]);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "linux")(
    "follows a projected-volume target after its internal data symlink is swapped",
    async () => {
      const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-projected-volume-"));
      try {
        const fixture = await createProjectedVolumeFixture(tempDirectory, true);

        const initialSnapshot = await loadFlagSnapshotFile(fixture.visiblePath);
        await fixture.swap(false);
        const swappedSnapshot = await loadFlagSnapshotFile(fixture.visiblePath);

        expect(getCheckoutDefaultEnabled(initialSnapshot)).toBe(true);
        expect(getCheckoutDefaultEnabled(swappedSnapshot)).toBe(false);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform === "linux")(
    "reloads a projected-volume target through opt-in consistency polling",
    async () => {
      const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-projected-watch-"));
      try {
        const fixture = await createProjectedVolumeFixture(tempDirectory, true);
        const snapshots: boolean[] = [];
        const watcher = await watchFlagSnapshotFile({
          path: fixture.visiblePath,
          debounceMs: 10,
          consistencyPollIntervalMs: 50,
          onSnapshot(snapshot) {
            snapshots.push(getCheckoutDefaultEnabled(snapshot));
          }
        });

        try {
          await fixture.swap(false);
          await waitFor(() => snapshots.at(-1) === false);
          expect(snapshots).toEqual([true, false]);
        } finally {
          watcher.close();
        }
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform === "linux")(
    "preserves and recovers the last snapshot when a polled target disappears",
    async () => {
      const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-projected-recovery-"));
      try {
        const fixture = await createProjectedVolumeFixture(tempDirectory, true);
        const snapshots: boolean[] = [];
        const errors: unknown[] = [];
        const watcher = await watchFlagSnapshotFile({
          path: fixture.visiblePath,
          debounceMs: 10,
          consistencyPollIntervalMs: 50,
          onSnapshot(snapshot) {
            snapshots.push(getCheckoutDefaultEnabled(snapshot));
          },
          onError(error) {
            errors.push(error);
          }
        });

        try {
          await fixture.detach();
          await waitFor(() => errors.length > 0);
          expect(getCheckoutDefaultEnabled(watcher.getSnapshot() as FlagSnapshot)).toBe(true);

          await fixture.swap(false);
          await waitFor(() => snapshots.at(-1) === false);
          expect(snapshots).toEqual([true, false]);
        } finally {
          watcher.close();
        }
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    }
  );

  it("does not publish queued reloads after close", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-close-reload-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(true), "utf8");
      const secondCallbackStarted = createDeferred();
      const releaseSecondCallback = createDeferred();
      let callbackCount = 0;
      const watcher = await watchFlagSnapshotFile({
        path,
        async onSnapshot() {
          callbackCount += 1;
          if (callbackCount === 2) {
            secondCallbackStarted.resolve();
            await releaseSecondCallback.promise;
          }
        }
      });

      await writeFile(path, createJsonSnapshot(false), "utf8");
      const activeReload = watcher.reload();
      await secondCallbackStarted.promise;
      const queuedReload = watcher.reload();
      watcher.close();
      releaseSecondCallback.resolve();

      await Promise.all([activeReload, queuedReload]);
      expect(callbackCount).toBe(2);
      expect(getCheckoutDefaultEnabled(watcher.getSnapshot() as FlagSnapshot)).toBe(true);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rejects unsafe consistency poll intervals before creating a watcher", async () => {
    await expect(
      watchFlagSnapshotFile({
        path: "flags.json",
        consistencyPollIntervalMs: 49,
        onSnapshot() {
          return undefined;
        }
      })
    ).rejects.toThrow("consistencyPollIntervalMs must be an integer greater than or equal to 50");
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

async function createProjectedVolumeFixture(root: string, enabled: boolean) {
  let revision = 0;
  const visiblePath = join(root, "flags.json");
  const dataLinkPath = join(root, "..data");

  async function writeRevision(nextEnabled: boolean): Promise<string> {
    revision += 1;
    const revisionName = `..snapshot-${revision}`;
    const revisionPath = join(root, revisionName);
    await mkdir(revisionPath);
    await writeFile(join(revisionPath, "flags.json"), createJsonSnapshot(nextEnabled), "utf8");
    return revisionName;
  }

  const initialRevision = await writeRevision(enabled);
  await symlink(initialRevision, dataLinkPath, "dir");
  await symlink(join("..data", "flags.json"), visiblePath, "file");

  return {
    visiblePath,
    async detach(): Promise<void> {
      await rename(dataLinkPath, join(root, "..data-detached"));
    },
    async swap(nextEnabled: boolean): Promise<void> {
      const nextRevision = await writeRevision(nextEnabled);
      const temporaryLinkPath = join(root, "..data-next");
      await symlink(nextRevision, temporaryLinkPath, "dir");
      await rename(temporaryLinkPath, dataLinkPath);
    }
  };
}

function createDeferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise
  };
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
