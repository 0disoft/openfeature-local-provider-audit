import { constants, type Stats } from "node:fs";
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

interface Journal {
  readonly schemaVersion: 1;
  readonly artifacts: readonly string[];
}

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
    let before: Stats;
    try {
      before = await lstat(path);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    assertRegular(before);
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );
    try {
      const stats = await handle.stat();
      assertRegular(stats);
      if (!sameFile(before, stats) || stats.size > maxBytes) throw unavailable();
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
        const { bytesRead } = await handle.read(buffer);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) throw unavailable();
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const journal: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total))
      );
      if (journal === null || typeof journal !== "object" || Array.isArray(journal))
        throw unavailable();
      const record = journal as Record<string, unknown>;
      if (
        Object.keys(record).length !== 2 ||
        record.schemaVersion !== 1 ||
        !Array.isArray(record.artifacts) ||
        record.artifacts.length < 1 ||
        record.artifacts.length > 32 ||
        !record.artifacts.every((artifact) => typeof artifact === "string" && artifact.length > 0)
      )
        throw unavailable();
      return record as unknown as Journal;
    } finally {
      await handle.close();
    }
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

  async function writeJournal(journal: Journal): Promise<void> {
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    let handle: FileHandle | undefined;
    let created = false;
    try {
      handle = await open(temporary, "wx", 0o600);
      created = true;
      await handle.writeFile(serialize(journal), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
      if (process.platform !== "win32") {
        const parent = await open(directory, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      try {
        await handle?.close();
      } finally {
        if (created)
          await unlink(temporary).catch((error: unknown) => {
            if (!isMissing(error)) throw error;
          });
      }
    }
  }

  return {
    async load() {
      try {
        const journal = await readJournal();
        return journal === undefined ? undefined : authenticate(journal);
      } catch {
        throw unavailable();
      }
    },
    async commit(content) {
      // Capture before the first await: caller buffer mutation cannot change what commits.
      let bytes: Uint8Array;
      try {
        if (content.byteLength > maxBytes) throw unavailable();
        bytes = Uint8Array.from(content);
      } catch {
        throw unavailable();
      }
      let lock: FileHandle | undefined;
      let lockStats: Stats | undefined;
      try {
        if (createDirectory) await mkdir(directory, { recursive: true, mode: 0o700 });
        lock = await open(lockPath, "wx", 0o600);
        lockStats = await lock.stat();
        const previous = await readJournal();
        const recovery = previous === undefined ? undefined : authenticate(previous);
        const verified = verifier.verify(bytes, recovery?.floor);
        if (verified.provenance.artifactHash === recovery?.floor.artifactHash) return verified;
        const token = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
        const artifacts = [token, ...(previous?.artifacts ?? [])].slice(0, maxHistory);
        while (
          Buffer.byteLength(serialize({ schemaVersion: 1, artifacts })) > maxBytes &&
          artifacts.length > 1
        )
          artifacts.pop();
        const journal: Journal = { schemaVersion: 1, artifacts };
        if (Buffer.byteLength(serialize(journal)) > maxBytes) throw unavailable();
        await writeJournal(journal);
        return verified;
      } catch {
        throw unavailable();
      } finally {
        // No stale takeover: only the owner of this acquired marker may release it.
        if (lock !== undefined) await releaseLock(lock, lockStats, lockPath);
      }
    }
  };
}

function serialize(journal: Journal): string {
  return `${JSON.stringify(journal)}\n`;
}
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function assertRegular(stats: Stats): void {
  if (
    !stats.isFile() ||
    stats.nlink !== 1 ||
    (process.platform !== "win32" && process.getuid !== undefined && stats.uid !== process.getuid())
  )
    throw unavailable();
}
function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
function unavailable(): LocalProviderError {
  return new LocalProviderError("PROVIDER_NOT_READY", "Snapshot recovery storage is unavailable.");
}

async function releaseLock(
  lock: FileHandle,
  expected: Stats | undefined,
  path: string
): Promise<void> {
  let failed = false;
  try {
    await lock.close();
  } catch {
    failed = true;
  }
  try {
    const current = await lstat(path);
    if (expected !== undefined && sameFile(current, expected)) await unlink(path);
  } catch (error) {
    if (!isMissing(error)) failed = true;
  }
  if (failed) throw unavailable();
}
