import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileSnapshotStore,
  createReloadableLocalProvider,
  createSnapshotRefresher,
  createSnapshotVerifier,
  signFlagSnapshot,
  type FileSnapshotStoreOptions,
  type FlagSnapshot
} from "../../src/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const NOW = Date.now();
const keys = generateKeyPairSync("ed25519");
const rotated = generateKeyPairSync("ed25519");
const verification = {
  trustedKeys: { release: keys.publicKey, rotated: rotated.publicKey },
  audience: "test/production"
};
let directory: string;
let path: string;
const snapshot: FlagSnapshot = {
  schemaVersion: 1,
  flags: {
    feature: { type: "boolean", variants: { on: true, off: false }, defaultVariant: "on" }
  }
};
function token(sequence: number, extra = {}) {
  return Buffer.from(
    signFlagSnapshot({
      snapshot,
      privateKey: keys.privateKey,
      keyId: "release",
      audience: verification.audience,
      sequence,
      issuedAt: NOW - 1000,
      expiresAt: NOW + 60_000,
      ...extra
    })
  );
}
function store(extra: Partial<FileSnapshotStoreOptions> = {}) {
  return createFileSnapshotStore({ path, verification, ...extra });
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-recovery-"));
  path = join(directory, "state.json");
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-recovery-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

describe("signed snapshot recovery store", () => {
  it("recovers in a separate process with exact origin and bounded immutable history", async () => {
    expect(await store().load()).toBeUndefined();
    await store().commit(token(1));
    const accepted = await store().commit(token(2));
    const recovered = await store().load();
    expect(recovered?.current).toEqual(accepted);
    expect(recovered?.history.map((entry) => entry.provenance.sequence)).toEqual([2, 1]);
    expect(Object.isFrozen(recovered?.history)).toBe(true);
    expect(Object.isFrozen(recovered?.history[0]?.snapshot.flags)).toBe(true);
    const script = `
      const api = await import(${JSON.stringify(new URL("../../dist/index.js", import.meta.url).href)});
      const store = api.createFileSnapshotStore({ path: ${JSON.stringify(path)}, verification: {
        audience: "test/production", trustedKeys: { release: ${JSON.stringify(keys.publicKey.export({ format: "pem", type: "spki" }))} }
      } });
      const recovery = await store.load();
      const provider = api.createReloadableLocalProvider({ ...recovery.current, env: {} });
      const result = await provider.resolveBooleanEvaluation("feature", false, {}, { warn() {} });
      console.log(JSON.stringify({ sequence: recovery.floor.sequence, hash: provider.getStatus().provenance.artifactHash, value: result.value }));
    `;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script
    ]);
    expect(JSON.parse(stdout)).toEqual({
      sequence: 2,
      hash: accepted.provenance.artifactHash,
      value: true
    });
  });

  it("retains expired origin as a floor without activation and prevents downgrade after restart", async () => {
    await store().commit(token(3, { expiresAt: NOW + 1000 }));
    vi.mocked(Date.now).mockReturnValue(NOW + 2000);
    const recovered = await store().load();
    expect(recovered?.current).toBeUndefined();
    expect(recovered?.floor.sequence).toBe(3);
    expect(recovered?.history[0]?.snapshot).toEqual(snapshot);
    await expect(store().commit(token(2))).rejects.toThrow(
      "Snapshot recovery storage is unavailable."
    );
    const provider = createReloadableLocalProvider({ snapshot, env: {} });
    const refresher = createSnapshotRefresher({
      provider,
      ...(recovered ? { previous: recovered.floor } : {}),
      verifier: createSnapshotVerifier(verification),
      source: {
        async fetch() {
          return { status: "content", content: token(2) };
        }
      }
    });
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(provider.getStatus().provenance).toBeUndefined();
    refresher.close();
    await store().commit(token(4, { issuedAt: NOW + 2000 }));
    expect((await store().load())?.current?.provenance.sequence).toBe(4);
  });

  it("rolls back contents only as a newly signed higher sequence", async () => {
    await store().commit(token(1));
    const disabled: FlagSnapshot = {
      schemaVersion: 1,
      flags: {
        feature: {
          type: "boolean",
          variants: { on: true, off: false },
          defaultVariant: "off"
        }
      }
    };
    await store().commit(token(2, { snapshot: disabled }));
    const recovered = await store().load();
    const selected = recovered?.history.find((entry) => entry.provenance.sequence === 1);
    expect(selected?.snapshot).toEqual(snapshot);
    await expect(store().commit(token(1))).rejects.toThrow();
    await store().commit(token(3, { snapshot: selected?.snapshot }));
    const rolledBack = await store().load();
    expect(rolledBack?.current?.snapshot).toEqual(snapshot);
    expect(rolledBack?.floor.sequence).toBe(3);
  });

  it("rejects equivocation, earlier issuance and unsigned content without changing committed bytes", async () => {
    const original = token(3);
    await store().commit(original);
    const before = await readFile(path);
    for (const artifact of [
      token(2),
      token(3, { expiresAt: NOW + 50_000 }),
      token(4, { issuedAt: NOW - 2000 }),
      Buffer.from(JSON.stringify(snapshot))
    ]) {
      await expect(store().commit(artifact)).rejects.toThrow();
      expect(await readFile(path)).toEqual(before);
    }
    await store().commit(original);
    expect((await store().load())?.history).toHaveLength(1);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("caps history by count and total bytes, preserves fresh head and captures caller buffers", async () => {
    const target = store({ maxHistory: 2 });
    const mutable = token(1);
    const pending = target.commit(mutable);
    mutable.fill(0);
    await pending;
    await target.commit(token(2));
    await target.commit(token(3));
    expect((await target.load())?.history.map((entry) => entry.provenance.sequence)).toEqual([
      3, 2
    ]);
    const head = token(4);
    const limit =
      Buffer.byteLength(JSON.stringify({ schemaVersion: 1, artifacts: [head.toString()] })) + 1;
    const separate = store({ path: join(directory, "bounded.json"), maxBytes: limit });
    await separate.commit(token(1));
    await separate.commit(head);
    expect((await separate.load())?.history).toHaveLength(1);
    expect((await lstat(join(directory, "bounded.json"))).size).toBeLessThanOrEqual(limit);
    await expect(
      store({ path: join(directory, "tiny.json"), maxBytes: 1 }).commit(head)
    ).rejects.toThrow();
  });

  it("fails closed on a corrupt head and never promotes older valid history", async () => {
    await store().commit(token(1));
    await store().commit(token(2));
    const journal = JSON.parse(await readFile(path, "utf8"));
    journal.artifacts[0] = `${journal.artifacts[0]}invalid`;
    await writeFile(path, JSON.stringify(journal));
    await expect(store().load()).rejects.toThrow();
    await expect(store().commit(token(3))).rejects.toThrow();
  });

  it("recovers a trusted rotated head while excluding retired or corrupted older history", async () => {
    await store().commit(token(1));
    await store().commit(token(2, { privateKey: rotated.privateKey, keyId: "rotated" }));
    const retired = store({
      verification: { ...verification, trustedKeys: { rotated: rotated.publicKey } }
    });
    const recovered = await retired.load();
    expect(recovered?.current?.provenance.keyId).toBe("rotated");
    expect(recovered?.history).toHaveLength(1);
    await retired.commit(token(3, { privateKey: rotated.privateKey, keyId: "rotated" }));
    expect((await retired.load())?.floor.sequence).toBe(3);
  });

  it("does not bypass configured minimum sequence when activating recovered state", async () => {
    await store().commit(token(1));
    const recovered = await store({ verification: { ...verification, minSequence: 2 } }).load();
    expect(recovered?.floor.sequence).toBe(1);
    expect(recovered?.current).toBeUndefined();
  });

  it("rejects malformed/oversized journals and nonregular or multiply linked targets", async () => {
    for (const value of [
      null,
      [],
      {},
      { schemaVersion: 2, artifacts: ["x"] },
      { schemaVersion: 1, artifacts: [] },
      { schemaVersion: 1, artifacts: [0] },
      { schemaVersion: 1, artifacts: ["x"], extra: true }
    ]) {
      await writeFile(path, JSON.stringify(value));
      await expect(store().load()).rejects.toThrow();
    }
    await writeFile(path, " ".repeat(100));
    await expect(store({ maxBytes: 50 }).load()).rejects.toThrow();
    await rm(path);
    await mkdir(path);
    await expect(store().load()).rejects.toThrow();
    await rmdir(path);
    await store().commit(token(1));
    await link(path, join(directory, "alias.json"));
    await expect(store().load()).rejects.toThrow();
    await expect(store().commit(token(2))).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks and creates private POSIX files",
    async () => {
      await store().commit(token(1));
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
      const alias = join(directory, "symlink.json");
      await symlink(path, alias);
      await expect(store({ path: alias }).load()).rejects.toThrow();
      await expect(store({ path: alias }).commit(token(2))).rejects.toThrow();
    }
  );

  it("preserves foreign lock markers, fails contention immediately and recovers after release", async () => {
    await store().commit(token(1));
    await writeFile(`${path}.lock`, "external-owner");
    await expect(store().commit(token(2))).rejects.toThrow();
    expect(await readFile(`${path}.lock`, "utf8")).toBe("external-owner");
    expect((await store().load())?.floor.sequence).toBe(1);
    await rm(`${path}.lock`);
    await store().commit(token(2));
    expect((await store().load())?.floor.sequence).toBe(2);
  });

  it("preserves the last journal on failed rename and removes owned temporary/lock files", async () => {
    await store().commit(token(1));
    const before = await readFile(path);
    vi.mocked(rename).mockRejectedValueOnce(new Error("internal path details"));
    await expect(store().commit(token(2))).rejects.toThrow(
      "Snapshot recovery storage is unavailable."
    );
    expect(await readFile(path)).toEqual(before);
    expect(await readdir(directory)).toEqual(["state.json"]);
    await store().commit(token(2));
    expect((await store().load())?.floor.sequence).toBe(2);
  });

  it("creates directories only when opted in and rejects invalid store/floor configuration", async () => {
    const nested = join(directory, "new", "state.json");
    await expect(store({ path: nested }).commit(token(1))).rejects.toThrow();
    await store({
      path: new URL(`file:///${nested.replaceAll("\\", "/")}`),
      createDirectory: true
    }).commit(token(1));
    expect((await store({ path: nested }).load())?.floor.sequence).toBe(1);
    expect(() => store({ maxHistory: 0 })).toThrow();
    expect(() => store({ maxBytes: Number.NaN })).toThrow();
    const first = createSnapshotVerifier(verification).verify(token(1));
    const provider = createReloadableLocalProvider({ ...first, env: {} });
    const source = {
      async fetch() {
        return { status: "content" as const, content: token(2) };
      }
    };
    expect(() => createSnapshotRefresher({ provider, source, previous: first.provenance })).toThrow(
      "signed verifier"
    );
    expect(() =>
      createSnapshotRefresher({
        provider,
        source,
        verifier: createSnapshotVerifier(verification),
        previous: { ...first.provenance, artifactHash: "a".repeat(64) }
      })
    ).toThrow("conflicts");
  });
});
