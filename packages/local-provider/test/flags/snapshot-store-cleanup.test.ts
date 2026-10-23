import { generateKeyPairSync } from "node:crypto";
import {
  lstat,
  open,
  rename,
  unlink,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createFileSnapshotStore,
  createSnapshotRefresher,
  createSnapshotVerifier,
  createReloadableLocalProvider,
  signFlagSnapshot
} from "../../src/index.js";
import { failureCause } from "../../src/sources/failure-cause.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    lstat: vi.fn(actual.lstat),
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink)
  };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const keys = generateKeyPairSync("ed25519");
const verification = { audience: "store/cleanup", trustedKeys: { release: keys.publicKey } };
const snapshot = { schemaVersion: 1 as const, flags: {} };
let directory: string, path: string;
let faults: Partial<
  Record<
    | "write"
    | "sync"
    | "tempClose"
    | "tempUnlink"
    | "rename"
    | "lockClose"
    | "lockUnlink"
    | "lockLstat"
    | "lockStat"
    | "read"
    | "journalClose",
    Error
  >
>;
let replaceLock: boolean;
const closes = new Map<string, ReturnType<typeof vi.fn>>();
function token(sequence: number) {
  return Buffer.from(
    signFlagSnapshot({
      snapshot,
      privateKey: keys.privateKey,
      keyId: "release",
      audience: verification.audience,
      sequence,
      issuedAt: Date.now() - 1000,
      expiresAt: Date.now() + 60000
    })
  );
}
const store = () => createFileSnapshotStore({ path, verification });
function leaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}
function expectPrivate(error: unknown) {
  expect(error).toMatchObject({
    code: "PROVIDER_NOT_READY",
    message: "Snapshot recovery storage is unavailable."
  });
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("errors");
  expect(JSON.stringify(error)).not.toContain("sensitive");
}
beforeEach(async () => {
  faults = {};
  replaceLock = false;
  closes.clear();
  directory = await mkdtemp(join(tmpdir(), "of-store-cleanup-"));
  path = join(directory, "state.json");
  vi.mocked(open).mockImplementation(async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const file = String(args[0]);
    const kind = file.endsWith(".tmp") ? "temp" : file.endsWith(".lock") ? "lock" : "journal";
    const close = handle.close.bind(handle);
    const closing = vi.spyOn(handle, "close").mockImplementation(async () => {
      await close();
      if (kind === "lock" && replaceLock)
        await actual.rename(join(directory, "foreign.lock"), file);
      const failure =
        faults[kind === "temp" ? "tempClose" : kind === "lock" ? "lockClose" : "journalClose"];
      if (failure) throw failure;
    });
    closes.set(kind, closing);
    if (kind === "lock" && faults.lockStat)
      vi.spyOn(handle, "stat").mockRejectedValue(faults.lockStat);
    if (kind === "temp") {
      if (faults.write) vi.spyOn(handle, "writeFile").mockRejectedValue(faults.write);
      if (faults.sync) vi.spyOn(handle, "sync").mockRejectedValue(faults.sync);
    }
    if (kind === "journal" && faults.read) vi.spyOn(handle, "read").mockRejectedValue(faults.read);
    return handle;
  });
  vi.mocked(lstat).mockImplementation(async (...args: Parameters<typeof actual.lstat>) => {
    if (String(args[0]).endsWith(".lock") && faults.lockLstat) throw faults.lockLstat;
    return actual.lstat(...args);
  });
  vi.mocked(rename).mockImplementation(async (...args) => {
    if (faults.rename) throw faults.rename;
    return actual.rename(...args);
  });
  vi.mocked(unlink).mockImplementation(async (file) => {
    const failure = String(file).endsWith(".tmp") ? faults.tempUnlink : faults.lockUnlink;
    if (failure) throw failure;
    return actual.unlink(file);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-store-cleanup-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

it("retains publication, temp deletion, lock close and marker deletion causes privately", async () => {
  const target = store();
  await target.commit(token(1));
  const before = await readFile(path);
  faults = {
    rename: new Error("sensitive rename"),
    tempUnlink: new Error("sensitive temp"),
    lockClose: new Error("sensitive close"),
    lockUnlink: new Error("sensitive lock")
  };
  vi.mocked(rename).mockClear();
  const error = await target.commit(token(2)).catch((error: unknown) => error);
  expectPrivate(error);
  expect(leaves(failureCause(error))).toEqual([
    faults.rename,
    faults.tempUnlink,
    faults.lockClose,
    faults.lockUnlink
  ]);
  expect((failureCause(error) as AggregateError).cause).toMatchObject({ cause: faults.rename });
  expect(closes.get("temp")).toHaveBeenCalledOnce();
  expect(closes.get("lock")).toHaveBeenCalledOnce();
  expect(rename).toHaveBeenCalledOnce();
  expect((await readFile(path)).equals(before)).toBe(true);
});

it.each(["write", "sync"] as const)(
  "closes once and retains %s, close and temporary-file failures",
  async (stage) => {
    const target = store();
    await target.commit(token(1));
    const before = await readFile(path);
    faults = {
      [stage]: new Error("sensitive primary"),
      tempClose: new Error("sensitive close"),
      tempUnlink: new Error("sensitive unlink")
    };
    vi.mocked(rename).mockClear();
    const error = await target.commit(token(2)).catch((error: unknown) => error);
    expectPrivate(error);
    expect(leaves(failureCause(error))).toEqual([
      faults[stage],
      faults.tempClose,
      faults.tempUnlink
    ]);
    expect(closes.get("temp")).toHaveBeenCalledOnce();
    expect(closes.get("lock")).toHaveBeenCalledOnce();
    expect(rename).not.toHaveBeenCalled();
    expect((await readFile(path)).equals(before)).toBe(true);
    expect(await readdir(directory)).not.toContain("state.json.lock");
  }
);

it("retains journal read and close failures on load", async () => {
  const target = store();
  await target.commit(token(1));
  faults = { read: new Error("sensitive read"), journalClose: new Error("sensitive close") };
  const error = await target.load().catch((error: unknown) => error);
  expectPrivate(error);
  expect(leaves(failureCause(error))).toEqual([faults.read, faults.journalClose]);
  expect(closes.get("journal")).toHaveBeenCalledOnce();
});

it("retains verification failure together with lock close and identity-check failures", async () => {
  faults = { lockClose: new Error("sensitive close"), lockLstat: new Error("sensitive lstat") };
  const error = await store()
    .commit(Buffer.from("invalid signed artifact"))
    .catch((error: unknown) => error);
  expectPrivate(error);
  const failures = leaves(failureCause(error));
  expect(failures[0]).toMatchObject({ code: "SCHEMA_ERROR" });
  expect(failures.slice(1)).toEqual([faults.lockClose, faults.lockLstat]);
  expect(closes.get("lock")).toHaveBeenCalledOnce();
  expect(await readdir(directory)).toEqual(["state.json.lock"]);
});

it("closes once but preserves a marker whose acquired identity could not be read", async () => {
  faults = { lockStat: new Error("sensitive fstat"), lockClose: new Error("sensitive close") };
  const error = await store()
    .commit(token(1))
    .catch((error: unknown) => error);
  expectPrivate(error);
  expect(leaves(failureCause(error))).toEqual([faults.lockStat, faults.lockClose]);
  expect(closes.get("lock")).toHaveBeenCalledOnce();
  expect(unlink).not.toHaveBeenCalledWith(`${path}.lock`);
  expect(await readdir(directory)).toEqual(["state.json.lock"]);
});

it("preserves a foreign lock replacement even when close fails", async () => {
  await writeFile(join(directory, "foreign.lock"), "foreign owner");
  replaceLock = true;
  faults = { lockClose: new Error("sensitive close") };
  const error = await store()
    .commit(token(1))
    .catch((error: unknown) => error);
  expectPrivate(error);
  expect(failureCause(error)).toBe(faults.lockClose);
  expect(await readFile(`${path}.lock`, "utf8")).toBe("foreign owner");
  expect(unlink).not.toHaveBeenCalledWith(`${path}.lock`);
});

it("keeps an ambiguous accepted journal when only lock cleanup fails and never retries it", async () => {
  const target = store();
  const artifact = token(1);
  faults = { lockClose: new Error("sensitive close") };
  const error = await target.commit(artifact).catch((error: unknown) => error);
  expectPrivate(error);
  expect(failureCause(error)).toBe(faults.lockClose);
  expect((await target.load())?.floor.sequence).toBe(1);
  expect(rename).toHaveBeenCalledOnce();
  expect(await readdir(directory)).toEqual(["state.json"]);
  faults = {};
  await target.commit(artifact);
  expect((await target.load())?.history).toHaveLength(1);
  expect(rename).toHaveBeenCalledOnce();
});

it("delivers the full compound cause through refresher onFailure without publishing it or activating", async () => {
  const target = store();
  const accepted = await target.commit(token(1));
  const provider = createReloadableLocalProvider({ ...accepted, env: {} });
  const onFailure = vi.fn();
  const refresher = createSnapshotRefresher({
    provider,
    store: target,
    verifier: createSnapshotVerifier(verification),
    source: {
      async fetch() {
        return { status: "content", content: token(2) };
      }
    },
    onFailure
  });
  faults = {
    rename: new Error("sensitive rename"),
    tempUnlink: new Error("sensitive temp"),
    lockClose: new Error("sensitive close")
  };
  try {
    const error = await refresher.refresh().catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "PROVIDER_NOT_READY",
      message: "Snapshot persistence is unavailable."
    });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("sensitive");
    expect(onFailure).toHaveBeenCalledOnce();
    const diagnostic = onFailure.mock.calls[0]?.[0];
    expect(diagnostic).toMatchObject({ kind: "persist", timedOut: false });
    expect(leaves(diagnostic.cause)).toEqual([faults.rename, faults.tempUnlink, faults.lockClose]);
    expect(provider.getStatus().failedRefreshes).toBe(1);
    expect(provider.getStatus().provenance).toEqual(accepted.provenance);
    expect(JSON.stringify(provider.getStatus())).not.toContain("sensitive");
    expect(refresher.getProvenance()).toBeUndefined();
    provider.updateSnapshot(snapshot); // Failed persistence releases its preparation.
  } finally {
    refresher.close();
  }
});
