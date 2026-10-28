import { withStoreCleanup } from "./store-cleanup.js";
import { retainFailureCause } from "./failure-cause.js";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type {
  FileSnapshotStoreOptions,
  SignedSnapshotStore,
  SnapshotRecovery,
  VerifiedFlagSnapshot
} from "../public-types.js";
import { sourceInteger } from "./source-policy.js";
import { createHistoricalSnapshotVerifier, createSnapshotVerifier } from "./signed-snapshot.js";
import {
  boundedSnapshotJournal,
  parseSnapshotJournal,
  type SnapshotJournal as Journal
} from "./snapshot-journal.js";

export function createFileSnapshotStore(options: FileSnapshotStoreOptions): SignedSnapshotStore {
  const path = resolve(
    typeof options.path === "string" ? options.path : fileURLToPath(options.path)
  );
  const directory = dirname(path);
  const lockPath = `${path}.lock`;
  const maxBytes = sourceInteger(
    "maxBytes",
    options.maxBytes ?? 16 * 1024 * 1024,
    1,
    100 * 1024 * 1024
  );
  const maxHistory = sourceInteger("maxHistory", options.maxHistory ?? 5, 1, 32);
  const createDirectory = options.createDirectory ?? false;
  const verifier = createSnapshotVerifier(options.verification);
  const historical = createHistoricalSnapshotVerifier(options.verification);

  async function readJournal(): Promise<Journal | undefined> {
    let before: BigIntStats;
    try {
      before = await lstat(path, { bigint: true });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    assertRegular(before);
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );
    return withStoreCleanup(
      async () => {
        const stats = await handle.stat({ bigint: true });
        assertRegular(stats);
        if (!sameFile(before, stats) || stats.size > BigInt(maxBytes)) throw unavailable();
        // Reserve an EOF probe byte; short reads fill capacity rather than retain blocks.
        let buffer = Buffer.allocUnsafe(Number(stats.size) + 1);
        let total = 0;
        while (true) {
          if (total === buffer.length) {
            const expanded = Buffer.allocUnsafe(Math.min(maxBytes + 1, buffer.length * 2));
            buffer.copy(expanded, 0, 0, total);
            buffer = expanded;
          }
          const { bytesRead } = await handle.read(
            buffer,
            total,
            Math.min(64 * 1024, buffer.length - total),
            null
          );
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > maxBytes) throw unavailable();
        }
        return parseSnapshotJournal(
          new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total))
        );
      },
      () => handle.close(),
      "Snapshot journal read and close failed."
    );
  }

  function authenticate(journal: Journal): SnapshotRecovery {
    const headBytes = Buffer.from(journal.artifacts[0] ?? "", "utf8");
    const head = historical.verify(headBytes);
    const history: VerifiedFlagSnapshot[] = [head];
    for (const artifact of journal.artifacts.slice(1)) {
      let entry: VerifiedFlagSnapshot;
      try {
        entry = historical.verify(Buffer.from(artifact, "utf8"));
      } catch {
        // A retired history key must not prevent a trusted current head from recovery.
        continue;
      }
      const last = history[history.length - 1];
      if (
        last === undefined ||
        entry.provenance.sequence >= last.provenance.sequence ||
        entry.provenance.issuedAt > last.provenance.issuedAt
      )
        throw unavailable();
      history.push(entry);
    }
    let current: VerifiedFlagSnapshot | undefined;
    try {
      current = verifier.verify(headBytes, head.provenance);
    } catch {
      // Valid historical origin still supplies the durable replay floor, never activation.
    }
    return Object.freeze({
      floor: head.provenance,
      ...(current !== undefined ? { current } : {}),
      history: Object.freeze(history.slice(0, maxHistory))
    });
  }

  async function writeJournal(serialized: string): Promise<void> {
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    await withStoreCleanup(
      async () => {
        await withStoreCleanup(
          async () => {
            await handle.writeFile(serialized, "utf8");
            await handle.sync();
          },
          () => handle.close(),
          "Snapshot journal write and close failed."
        );
        await rename(temporary, path);
        if (process.platform !== "win32") {
          const parent = await open(directory, "r");
          await withStoreCleanup(
            parent.sync.bind(parent),
            parent.close.bind(parent),
            "Snapshot directory sync and close failed."
          );
        }
      },
      async () => {
        try {
          await unlink(temporary);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      },
      "Snapshot journal publication and temporary-file cleanup failed."
    );
  }

  return {
    async load(request = {}) {
      try {
        if (request.signal?.aborted) throw unavailable(request.signal.reason);
        const journal = await readJournal();
        if (request.signal?.aborted) throw unavailable(request.signal.reason);
        return journal === undefined ? undefined : authenticate(journal);
      } catch (cause) {
        throw unavailable(cause);
      }
    },
    async commit(content) {
      // Capture before the first await: caller buffer mutation cannot change what commits.
      let bytes: Uint8Array;
      try {
        if (content.byteLength > maxBytes) throw unavailable();
        bytes = Uint8Array.from(content);
      } catch (cause) {
        throw unavailable(cause);
      }
      try {
        if (createDirectory) await mkdir(directory, { recursive: true, mode: 0o700 });
        const lock = await open(lockPath, "wx", 0o600);
        let lockStats: BigIntStats | undefined;
        return await withStoreCleanup(
          async () => {
            lockStats = await lock.stat({ bigint: true });
            const previous = await readJournal();
            const recovery = previous === undefined ? undefined : authenticate(previous);
            const verified = verifier.verify(bytes, recovery?.floor);
            if (verified.provenance.artifactHash === recovery?.floor.artifactHash) return verified;
            const token = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
            const artifacts = [token, ...(previous?.artifacts ?? [])].slice(0, maxHistory);
            await writeJournal(boundedSnapshotJournal(artifacts, maxBytes));
            return verified;
          },
          () => releaseLock(lock, lockStats, lockPath),
          "Snapshot commit and lock release failed."
        );
      } catch (cause) {
        throw unavailable(cause);
      }
    }
  };
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function assertRegular(stats: BigIntStats): void {
  if (
    !stats.isFile() ||
    stats.nlink !== 1n ||
    (process.platform !== "win32" &&
      process.getuid !== undefined &&
      stats.uid !== BigInt(process.getuid()))
  )
    throw unavailable();
}
function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
function unavailable(cause?: unknown): LocalProviderError {
  return retainFailureCause(
    new LocalProviderError("PROVIDER_NOT_READY", "Snapshot recovery storage is unavailable."),
    cause
  );
}

async function releaseLock(
  lock: FileHandle,
  expected: BigIntStats | undefined,
  path: string
): Promise<void> {
  await withStoreCleanup(
    () => lock.close(),
    async () => {
      // No stale takeover: only an identity verified from this acquired marker
      // may be removed, including when close fails. Preserve foreign replacements.
      try {
        const current = await lstat(path, { bigint: true });
        if (expected !== undefined && sameFile(current, expected)) await unlink(path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
    "Snapshot lock close and owned-marker cleanup failed."
  );
}
