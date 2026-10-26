import { mkdtemp, opendir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createFileAuditSink } from "../../src/audit/audit-sink.js";
import type { AuditEvent } from "../../src/public-types.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, opendir: vi.fn(actual.opendir), rename: vi.fn(actual.rename) };
});
afterEach(() => vi.restoreAllMocks());
async function cleanup(directory: string): Promise<void> {
  expect(dirname(directory)).toBe(resolve(tmpdir()));
  expect(basename(directory)).toMatch(/^openfeature-sparse-/);
  await rm(directory, { recursive: true, force: true });
}
const event: AuditEvent = {
  schemaVersion: 1,
  eventId: "new",
  timestamp: "2026-10-26T00:00:00.000Z",
  providerName: "provider",
  flagKey: "feature",
  requestedType: "boolean",
  reason: "STATIC",
  source: "file",
  snapshotHash: "0".repeat(64),
  context: { targetingKeyPresent: false, keyMode: "none", keys: [], redacted: true }
};

it("moves only existing sparse backups in descending numeric order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-sparse-"));
  try {
    const path = join(directory, "audit.jsonl");
    const originals = {
      "": "active",
      ".1": "one",
      ".2": "two",
      ".10": "ten",
      ".999": "last",
      ".1000": "expired",
      ".01": "alias",
      ".1e2": "alias",
      ".0": "zero",
      ".1001": "outside",
      ".9007199254740992": "unsafe"
    };
    for (const [suffix, value] of Object.entries(originals)) await writeFile(path + suffix, value);
    const sink = createFileAuditSink({ path, createDirectory: false, maxBytes: 1, maxFiles: 1000 });
    vi.mocked(rename).mockClear();
    await sink.writeConfirmed?.(event);
    expect(vi.mocked(rename).mock.calls.map(([source]) => source)).toEqual(
      [999, 10, 2, 1].map((index) => `${path}.${index}`).concat(path)
    );
    for (const [suffix, value] of Object.entries({
      ".1": "active",
      ".2": "one",
      ".3": "two",
      ".11": "ten",
      ".1000": "last",
      ".01": "alias",
      ".1e2": "alias",
      ".0": "zero",
      ".1001": "outside",
      ".9007199254740992": "unsafe"
    }))
      expect(await readFile(path + suffix, "utf8")).toBe(value);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(event);
    const handle = await vi.mocked(opendir).mock.results.at(-1)?.value;
    expect(() => handle.readSync()).toThrow(expect.objectContaining({ code: "ERR_DIR_CLOSED" }));
  } finally {
    await cleanup(directory);
  }
});

it.each(["EACCES", "EPERM"])(
  "falls back to numbered rotation on %s discovery failure",
  async (code) => {
    const directory = await mkdtemp(join(tmpdir(), "openfeature-sparse-denied-"));
    try {
      const path = join(directory, "audit.jsonl");
      await writeFile(path, "active");
      await writeFile(`${path}.2`, "two");
      vi.mocked(opendir).mockRejectedValueOnce(Object.assign(new Error("denied"), { code }));
      const sink = createFileAuditSink({ path, createDirectory: false, maxBytes: 1, maxFiles: 64 });
      vi.mocked(rename).mockClear();
      await sink.writeConfirmed?.(event);
      expect(vi.mocked(rename).mock.calls).toHaveLength(64);
      expect(await readFile(`${path}.1`, "utf8")).toBe("active");
      expect(await readFile(`${path}.3`, "utf8")).toBe("two");
    } finally {
      await cleanup(directory);
    }
  }
);

it("does not iterate the configured range at the maximum safe retention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-sparse-limit-"));
  try {
    const path = join(directory, "audit.jsonl");
    await writeFile(path, "active");
    await writeFile(`${path}.${Number.MAX_SAFE_INTEGER - 1}`, "last");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let calls = 0;
    vi.mocked(rename).mockImplementation(async (source, target) => {
      if (++calls > 3) throw new Error("Unexpected range iteration");
      return actual.rename(source, target);
    });
    const sink = createFileAuditSink({
      path,
      createDirectory: false,
      maxBytes: 1,
      maxFiles: Number.MAX_SAFE_INTEGER
    });
    await sink.writeConfirmed?.(event);
    expect(calls).toBe(2);
    expect(await readFile(`${path}.${Number.MAX_SAFE_INTEGER}`, "utf8")).toBe("last");
    expect(await readFile(`${path}.1`, "utf8")).toBe("active");
  } finally {
    vi.mocked(rename).mockRestore();
    await cleanup(directory);
  }
});

it("propagates unexpected discovery failure without shifting any backups", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfeature-sparse-failure-"));
  try {
    const path = join(directory, "audit.jsonl");
    await writeFile(path, "active");
    const failure = Object.assign(new Error("discovery failed"), { code: "EIO" });
    vi.mocked(opendir).mockRejectedValueOnce(failure);
    vi.mocked(rename).mockClear();
    const sink = createFileAuditSink({ path, createDirectory: false, maxBytes: 1, maxFiles: 64 });
    await expect(sink.writeConfirmed?.(event)).rejects.toBe(failure);
    await expect(sink.flush?.()).rejects.toBe(failure);
    expect(rename).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe("active");
  } finally {
    await cleanup(directory);
  }
});

it.skipIf(process.platform !== "win32")(
  "finds backups through Windows path case aliases",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfeature-sparse-case-"));
    try {
      const path = join(directory, "audit.jsonl");
      await writeFile(path, "active");
      await writeFile(`${path}.2`, "two");
      const sink = createFileAuditSink({
        path: path.toUpperCase(),
        createDirectory: false,
        maxBytes: 1,
        maxFiles: 64
      });
      vi.mocked(rename).mockClear();
      await sink.writeConfirmed?.(event);
      expect(vi.mocked(rename).mock.calls).toHaveLength(2);
      expect(await readFile(`${path}.1`, "utf8")).toBe("active");
      expect(await readFile(`${path}.3`, "utf8")).toBe("two");
    } finally {
      await cleanup(directory);
    }
  }
);
