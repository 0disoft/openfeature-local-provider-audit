import { constants } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import {
  lstat,
  open,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rename,
  link,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createFileSnapshotStore, signFlagSnapshot } from "../../src/index.js";
import { diagnoseSnapshotJournal } from "../../src/sources/diagnose-snapshot-journal.js";
import { runCli } from "../../src/cli/run.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat) };
});
const keys = generateKeyPairSync("ed25519"),
  other = generateKeyPairSync("ed25519");
const now = Date.now();
const verification = {
  audience: "diagnostic/production",
  trustedKeys: { release: keys.publicKey }
};
let directory: string, path: string;
function token(sequence: number, overrides = {}) {
  return signFlagSnapshot({
    snapshot: {
      schemaVersion: 1,
      flags: {
        "private-flag": { type: "boolean", variants: { on: true }, defaultVariant: "on" }
      }
    },
    privateKey: keys.privateKey,
    keyId: "release",
    audience: verification.audience,
    sequence,
    issuedAt: now - 1000,
    expiresAt: now + 60000,
    ...overrides
  });
}
async function journal(artifacts = [token(2), token(1)]) {
  await writeFile(path, JSON.stringify({ schemaVersion: 1, artifacts }));
}
async function capture() {
  const files = (await readdir(directory)).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      bytes: (await readFile(join(directory, file))).toString("hex"),
      mtime: (await lstat(join(directory, file), { bigint: true })).mtimeNs
    }))
  );
}
async function run(args: string[]) {
  let stdout = "",
    stderr = "";
  const code = await runCli(["snapshot-diagnose", ...args], {
    cwd: directory,
    stdout(value) {
      stdout += value;
    },
    stderr(value) {
      stderr += value;
    }
  });
  return { code, stdout, stderr };
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-snapshot-diagnosis-"));
  path = join(directory, "state.json");
  vi.spyOn(Date, "now").mockReturnValue(now);
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockImplementation(actual.open);
  vi.mocked(lstat).mockImplementation(actual.lstat);
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-snapshot-diagnosis-"))).toBe(
    true
  );
  await rm(directory, { recursive: true, force: true });
});

it("authenticates real persisted history with read-only opens, no state changes and no private output", async () => {
  const store = createFileSnapshotStore({ path, verification });
  await store.commit(Buffer.from(token(1)));
  await store.commit(Buffer.from(token(2)));
  const before = await capture();
  vi.mocked(open).mockClear();
  const result = await diagnoseSnapshotJournal(path, { verification });
  expect(result).toMatchObject({
    status: "valid",
    artifacts: 2,
    headAuthenticated: true,
    activationEligible: true,
    authenticatedArtifacts: 2,
    consistentSnapshot: false,
    rollbackProtected: false,
    issues: []
  });
  const forbidden =
    constants.O_RDWR |
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_APPEND |
    constants.O_TRUNC;
  expect(open).toHaveBeenCalled();
  for (const [, flags] of vi.mocked(open).mock.calls) expect(Number(flags) & forbidden).toBe(0);
  expect(await capture()).toEqual(before);
  expect(JSON.stringify(result)).not.toMatch(
    /private-flag|diagnostic\/production|release|state.json|eyJ/
  );
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.issues)).toBe(true);
});
it("does not authenticate structure-only results or initialize missing journals", async () => {
  expect((await diagnoseSnapshotJournal(path)).status).toBe("missing");
  expect(await readdir(directory)).toEqual([]);
  await journal(["not-a-signed-artifact"]);
  expect(await diagnoseSnapshotJournal(path)).toMatchObject({
    status: "structureOnly",
    headAuthenticated: null,
    activationEligible: null
  });
  expect(await diagnoseSnapshotJournal(path, { verification })).toMatchObject({
    status: "issues",
    headAuthenticated: false,
    issues: [{ code: "HEAD_UNVERIFIABLE", artifactIndex: 0 }]
  });
});
it.each([
  null,
  [],
  {},
  { schemaVersion: 2, artifacts: ["x"] },
  { schemaVersion: 1, artifacts: [] },
  { schemaVersion: 1, artifacts: [1] },
  { schemaVersion: 1, artifacts: Array(33).fill("x") },
  { schemaVersion: 1, artifacts: ["x"], extra: true }
])("rejects invalid journal shape %j", async (value) => {
  await writeFile(path, JSON.stringify(value));
  expect((await diagnoseSnapshotJournal(path)).issues).toEqual([{ code: "JOURNAL_INVALID" }]);
});
it("distinguishes an authenticated expired replay floor from an activatable head", async () => {
  await journal([token(2, { expiresAt: now })]);
  expect(await diagnoseSnapshotJournal(path, { verification })).toMatchObject({
    status: "issues",
    headAuthenticated: true,
    activationEligible: false,
    issues: [{ code: "HEAD_NOT_ACTIVATABLE", artifactIndex: 0 }]
  });
  expect((await createFileSnapshotStore({ path, verification }).load())?.current).toBeUndefined();
});
it("checks minimum sequence for activation but not historical authentication", async () => {
  await journal();
  expect(
    await diagnoseSnapshotJournal(path, { verification: { ...verification, minSequence: 3 } })
  ).toMatchObject({
    headAuthenticated: true,
    activationEligible: false,
    authenticatedArtifacts: 2
  });
});
it("reports retired history separately without promoting or blocking a trusted current head", async () => {
  await journal([token(2), token(1, { privateKey: other.privateKey })]);
  expect(await diagnoseSnapshotJournal(path, { verification })).toMatchObject({
    status: "issues",
    headAuthenticated: true,
    activationEligible: true,
    authenticatedArtifacts: 1,
    issues: [{ code: "HISTORY_UNVERIFIABLE", artifactIndex: 1 }]
  });
});
it("detects nondecreasing authenticated history and blocks journal activation", async () => {
  await journal([token(2), token(3)]);
  expect(await diagnoseSnapshotJournal(path, { verification })).toMatchObject({
    headAuthenticated: true,
    activationEligible: false,
    issues: [{ code: "HISTORY_ORDER_INVALID", artifactIndex: 1 }]
  });
});
it("observes locks without opening the journal or taking over a marker", async () => {
  await writeFile(`${path}.lock`, "private owner");
  await writeFile(path, "bad");
  const before = await capture();
  vi.mocked(open).mockClear();
  expect((await diagnoseSnapshotJournal(path)).status).toBe("busy");
  expect(open).not.toHaveBeenCalled();
  expect(await capture()).toEqual(before);
});
it("reports temporary files without deleting them and enforces directory bounds", async () => {
  await journal();
  await writeFile(join(directory, ".state.json.interrupted.tmp"), "private");
  const before = await capture();
  expect((await diagnoseSnapshotJournal(path)).issues).toContainEqual({ code: "TEMPORARY_FILES" });
  expect((await diagnoseSnapshotJournal(path, { maxEntries: 1 })).issues).toEqual([
    { code: "ENTRY_LIMIT" }
  ]);
  expect(await capture()).toEqual(before);
});
it("accepts the exact byte limit and rejects oversized or multiply linked files before opening", async () => {
  await journal();
  const size = (await readFile(path)).length;
  expect((await diagnoseSnapshotJournal(path, { maxBytes: size })).status).toBe("structureOnly");
  vi.mocked(open).mockClear();
  expect((await diagnoseSnapshotJournal(path, { maxBytes: size - 1 })).issues).toEqual([
    { code: "BYTE_LIMIT" }
  ]);
  expect(open).not.toHaveBeenCalled();
  await link(path, join(directory, "alias"));
  expect((await diagnoseSnapshotJournal(path)).issues).toEqual([{ code: "UNSAFE_FILE" }]);
});
it("withholds corruption claims after a concurrent replacement, even when parsing failed", async () => {
  await writeFile(path, "invalid private JSON");
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (...args: Parameters<typeof lstat>) => {
    if (args[0] === path && typeof args[1] === "object" && args[1]?.bigint && ++calls === 4) {
      const replacement = join(directory, "replacement");
      await writeFile(replacement, "new");
      await rename(replacement, path);
    }
    return actual.lstat(...args);
  }) as typeof lstat);
  expect(await diagnoseSnapshotJournal(path)).toMatchObject({
    status: "changed",
    headAuthenticated: null,
    issues: []
  });
});
it("observes a lock arriving at the final check and clears prior verdicts", async () => {
  await journal();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (...args: Parameters<typeof lstat>) => {
    if (args[0] === `${path}.lock` && ++calls === 2) await writeFile(`${path}.lock`, "writer");
    return actual.lstat(...args);
  }) as typeof lstat);
  expect(await diagnoseSnapshotJournal(path, { verification })).toMatchObject({
    status: "busy",
    headAuthenticated: null,
    activationEligible: null,
    authenticatedArtifacts: 0,
    issues: []
  });
});
it("propagates pre-aborted cancellation without any filesystem open", async () => {
  const controller = new AbortController(),
    reason = new Error("cancel");
  controller.abort(reason);
  await expect(diagnoseSnapshotJournal(path, { signal: controller.signal })).rejects.toBe(reason);
  expect(open).not.toHaveBeenCalled();
});
it("drains and closes an opened handle before propagating cancellation", async () => {
  await journal();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const controller = new AbortController(),
    reason = new Error("cancel during open");
  let closed = false;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args),
      close = handle.close.bind(handle);
    handle.close = async () => {
      closed = true;
      await close();
    };
    controller.abort(reason);
    return handle;
  });
  await expect(diagnoseSnapshotJournal(path, { signal: controller.signal })).rejects.toBe(reason);
  expect(closed).toBe(true);
});

it("handles one-byte short reads and suppresses compound read/close failures", async () => {
  await journal();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args),
      read = handle.read.bind(handle);
    handle.read = ((buffer: Buffer, offset: number, length: number, position: number | null) =>
      read(buffer, offset, Math.min(length, 1), position)) as typeof handle.read;
    return handle;
  });
  expect((await diagnoseSnapshotJournal(path)).status).toBe("structureOnly");
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args),
      close = handle.close.bind(handle);
    handle.read = (async () => {
      throw new Error("private read cause");
    }) as typeof handle.read;
    handle.close = async () => {
      await close();
      throw new Error("private close cause");
    };
    return handle;
  });
  const result = await diagnoseSnapshotJournal(path);
  expect(result.issues).toEqual([{ code: "READ_FAILED" }]);
  expect(JSON.stringify(result)).not.toContain("private");
});

it("rechecks freshness after final asynchronous filesystem observations", async () => {
  await journal();
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (...args: Parameters<typeof lstat>) => {
    if (args[0] === `${path}.lock` && ++calls === 2)
      vi.spyOn(Date, "now").mockReturnValue(now + 60000);
    return actual.lstat(...args);
  }) as typeof lstat);
  expect(await diagnoseSnapshotJournal(path, { verification })).toMatchObject({
    headAuthenticated: true,
    activationEligible: false,
    issues: [{ code: "HEAD_NOT_ACTIVATABLE", artifactIndex: 0 }]
  });
});

it("accepts public-key CLI configuration and keeps failures redacted", async () => {
  await journal();
  await writeFile(
    join(directory, "verification.json"),
    JSON.stringify({
      ...verification,
      trustedKeys: {
        release: keys.publicKey.export({ format: "pem", type: "spki" })
      }
    })
  );
  const valid = await run(["state.json", "--verification", "verification.json"]);
  expect(valid.code).toBe(0);
  expect(JSON.parse(valid.stdout).status).toBe("valid");
  expect((await run(["state.json"])).code).toBe(0);
  for (const args of [
    [],
    ["x", "--bad", "1"],
    ["x", "--max-bytes", "0"],
    ["x", "--max-bytes", "NaN"],
    ["x", "--max-entries", "1", "--max-entries", "2"],
    ["x", "--verification", "absent-private.json"]
  ]) {
    const result = await run(args);
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain("absent-private");
  }
  expect((await run(["--help"])).code).toBe(0);
  const publicSettings = {
    audience: verification.audience,
    trustedKeys: { release: keys.publicKey.export({ format: "pem", type: "spki" }) }
  };
  for (const invalid of [
    { ...publicSettings, minSequence: null },
    { ...publicSettings, unknown: true },
    { ...publicSettings, trustedKeys: { release: 123 } }
  ]) {
    await writeFile(join(directory, "bad-verification.json"), JSON.stringify(invalid));
    expect((await run(["state.json", "--verification", "bad-verification.json"])).code).toBe(2);
  }
});
