import { constants } from "node:fs";
import { symlink } from "node:fs/promises";
import {
  appendFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuditEvent, createChainedFileAuditSink, evaluateFlag } from "../../src/index.js";
import { diagnoseAuditDirectory } from "../../src/audit/diagnose-directory.js";
import { runCli } from "../../src/cli/run.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat) };
});
let directory: string;
const request = { flagKey: "private-flag", expectedType: "boolean" as const, defaultValue: false };
const snapshot = { schemaVersion: 1 as const, flags: {} };
function event() {
  return createAuditEvent({
    snapshot,
    request,
    result: evaluateFlag(snapshot, request),
    providerName: "diagnostic-test"
  });
}
async function prepare() {
  const sink = createChainedFileAuditSink({ directory, chainId: "private-chain" });
  await sink.writeConfirmed?.(event());
  return sink;
}
async function capture() {
  const files = (await readdir(directory)).sort();
  return Promise.all(
    files.map(async (file) => {
      const path = join(directory, file),
        stats = await lstat(path);
      return {
        file,
        bytes: (await readFile(path)).toString("hex"),
        size: stats.size,
        mtime: stats.mtimeMs
      };
    })
  );
}
async function cli(args: string[]) {
  let stdout = "",
    stderr = "";
  const code = await runCli(["audit-diagnose", ...args], {
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
  directory = await mkdtemp(join(tmpdir(), "of-audit-diagnosis-"));
  vi.mocked(lstat).mockImplementation(
    (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).lstat
  );
  vi.mocked(open).mockImplementation(
    (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open
  );
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-audit-diagnosis-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

it("verifies using read-only opens and preserves every source byte and modification time", async () => {
  await prepare();
  const before = await capture();
  vi.mocked(open).mockClear();
  const result = await diagnoseAuditDirectory(directory);
  expect(result).toMatchObject({
    status: "valid",
    segments: 1,
    recordsVerified: 1,
    lockPresent: false,
    consistentSnapshot: false,
    checkpointAuthenticated: false,
    issues: []
  });
  expect(vi.mocked(open).mock.calls.length).toBeGreaterThan(0);
  const forbidden =
    constants.O_WRONLY |
    constants.O_RDWR |
    constants.O_CREAT |
    constants.O_TRUNC |
    constants.O_APPEND;
  for (const [, flags] of vi.mocked(open).mock.calls) {
    expect(typeof flags).toBe("number");
    expect((flags as number) & forbidden).toBe(0);
  }
  expect(await capture()).toEqual(before);
  expect(JSON.stringify(result)).not.toMatch(/private|segment-1|manifest.json|of-audit/);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.issues)).toBe(true);
});

it("does not initialize an empty or missing directory", async () => {
  expect((await diagnoseAuditDirectory(directory)).status).toBe("empty");
  expect(await readdir(directory)).toEqual([]);
  expect((await diagnoseAuditDirectory(join(directory, "absent"))).status).toBe("issues");
  expect(await readdir(directory)).toEqual([]);
});

it("reports a lock without opening, repairing or taking it over", async () => {
  await writeFile(join(directory, "manifest.json.lock"), "private owner information");
  await writeFile(join(directory, "manifest.json"), "invalid manifest");
  const before = await capture();
  vi.mocked(open).mockClear();
  expect(await diagnoseAuditDirectory(directory)).toMatchObject({
    status: "busy",
    lockPresent: true,
    recordsVerified: 0,
    issues: []
  });
  expect(open).not.toHaveBeenCalled();
  expect(await capture()).toEqual(before);
});

it.each([
  "missing",
  "invalid",
  "traversal",
  "gap",
  "head",
  "truncated",
  "tail",
  "orphan",
  "temporary",
  "unexpected"
])("reports %s evidence without repair or cleanup", async (kind) => {
  await prepare();
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const segmentPath = join(directory, manifest.segments[0].file);
  const expected = {
    missing: "MANIFEST_MISSING",
    invalid: "MANIFEST_INVALID",
    traversal: "MANIFEST_INVALID",
    gap: "MANIFEST_INVALID",
    head: "CHAIN_INVALID",
    truncated: "SEGMENT_SIZE_MISMATCH",
    tail: "UNCOMMITTED_TAIL",
    orphan: "UNREFERENCED_SEGMENTS",
    temporary: "TEMPORARY_FILES",
    unexpected: "UNEXPECTED_ENTRIES"
  }[kind];
  if (kind === "missing") await unlink(manifestPath);
  if (kind === "invalid") await writeFile(manifestPath, "{private invalid JSON}");
  if (["traversal", "gap", "head"].includes(kind)) {
    if (kind === "traversal") manifest.segments[0].file = "../private.jsonl";
    if (kind === "gap") manifest.segments[0].head.sequence = 0;
    if (kind === "head") manifest.segments[0].head.hash = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  if (kind === "truncated") await writeFile(segmentPath, "short\n");
  if (kind === "tail") await appendFile(segmentPath, "partial private evidence");
  if (kind === "orphan") await writeFile(join(directory, "segment-100.jsonl"), "private orphan");
  if (kind === "temporary")
    await writeFile(join(directory, ".chain-private.tmp"), "private temporary");
  if (kind === "unexpected") await writeFile(join(directory, "private.txt"), "private unexpected");
  const before = await capture();
  const result = await diagnoseAuditDirectory(directory);
  expect(result.status).toBe("issues");
  expect(result.issues).toContainEqual(expect.objectContaining({ code: expected }));
  expect(await capture()).toEqual(before);
  expect(JSON.stringify(result)).not.toContain("private");
});

it("supports retained suffixes without claiming independently authenticated checkpoints", async () => {
  const sink = createChainedFileAuditSink({
    directory,
    chainId: "retained",
    maxSegmentBytes: 1,
    maxSegments: 1
  });
  await sink.writeConfirmed?.(event());
  await sink.writeConfirmed?.(event());
  expect(await diagnoseAuditDirectory(directory)).toMatchObject({
    status: "valid",
    segments: 1,
    recordsVerified: 1,
    checkpointAuthenticated: false
  });
});

it.each(["bytes", "records", "entries"])("bounds %s without changing evidence", async (kind) => {
  await prepare();
  const before = await capture();
  const result = await diagnoseAuditDirectory(directory, {
    ...(kind === "bytes" ? { maxBytes: 1 } : {}),
    ...(kind === "records" ? { maxRecords: 0 } : {}),
    ...(kind === "entries" ? { maxEntries: 1 } : {})
  });
  expect(result.status).toBe("issues");
  expect(result.issues[0]?.code).toBe(kind === "entries" ? "ENTRY_LIMIT" : "VERIFICATION_LIMIT");
  expect(await capture()).toEqual(before);
});

it("marks a changed manifest inconclusive instead of claiming corruption", async () => {
  await prepare();
  const original = vi.mocked(lstat).getMockImplementation()!;
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (...args: Parameters<typeof lstat>) => {
    const stats = await original(...args);
    if (String(args[0]) === join(directory, "manifest.json") && ++calls >= 3) {
      return Object.create(stats, {
        mtimeNs: { value: (stats as { mtimeNs: bigint }).mtimeNs + 1n }
      });
    }
    return stats;
  }) as typeof lstat);
  expect(await diagnoseAuditDirectory(directory)).toMatchObject({
    status: "changed",
    consistentSnapshot: false,
    issues: []
  });
});

it("propagates cancellation without initializing or repairing storage", async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancellation");
  controller.abort(reason);
  await expect(diagnoseAuditDirectory(directory, { signal: controller.signal })).rejects.toBe(
    reason
  );
  expect(await readdir(directory)).toEqual([]);
});

it("closes the active segment when cancellation arrives during a record read", async () => {
  await prepare();
  const controller = new AbortController(),
    reason = new Error("cancel while reading");
  const original = vi.mocked(open).getMockImplementation()!;
  const close = vi.fn();
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(".jsonl")) {
      const read = handle.read.bind(handle),
        release = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockImplementation((async (...readArgs: Parameters<typeof read>) => {
        const result = await read(...readArgs);
        controller.abort(reason);
        return result;
      }) as typeof handle.read);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        close();
        await release();
      });
    }
    return handle;
  });
  await expect(diagnoseAuditDirectory(directory, { signal: controller.signal })).rejects.toBe(
    reason
  );
  expect(close).toHaveBeenCalledOnce();
});

it("rechecks a segment after verification failure to avoid a false corruption verdict", async () => {
  await prepare();
  const path = join(directory, "segment-1.jsonl");
  const bytes = await readFile(path);
  bytes[0] = 0;
  await writeFile(path, bytes);
  const original = vi.mocked(lstat).getMockImplementation()!;
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (...args: Parameters<typeof lstat>) => {
    const stats = await original(...args);
    return String(args[0]) === path && ++calls >= 3
      ? Object.create(stats, { mtimeNs: { value: (stats as { mtimeNs: bigint }).mtimeNs + 1n } })
      : stats;
  }) as typeof lstat);
  expect(await diagnoseAuditDirectory(directory)).toMatchObject({ status: "changed", issues: [] });
});

it("withholds a verdict when a writer lock appears at the final check", async () => {
  await prepare();
  const original = vi.mocked(lstat).getMockImplementation()!;
  let calls = 0;
  vi.mocked(lstat).mockImplementation((async (...args: Parameters<typeof lstat>) => {
    if (String(args[0]) === join(directory, "manifest.json.lock") && ++calls === 2)
      return original(join(directory, "manifest.json"));
    return original(...args);
  }) as typeof lstat);
  expect(await diagnoseAuditDirectory(directory)).toMatchObject({ status: "busy", issues: [] });
});

it.skipIf(process.platform === "win32").each(["manifest.json", "segment-1.jsonl"])(
  "rejects a symlink in %s without following it",
  async (name) => {
    await prepare();
    const path = join(directory, name),
      target = join(directory, "private-backup");
    const bytes = await readFile(path);
    await writeFile(target, bytes);
    await unlink(path);
    await symlink(target, path);
    const result = await diagnoseAuditDirectory(directory);
    expect(result.status).toBe("issues");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: name === "manifest.json" ? "MANIFEST_UNREADABLE" : "SEGMENT_UNREADABLE"
      })
    );
    expect(await readFile(target)).toEqual(bytes);
  }
);

it("exposes redacted JSON, help, diagnostic failure and generic usage errors through the CLI", async () => {
  await prepare();
  const success = await cli(["."]);
  expect(success.code).toBe(0);
  expect(JSON.parse(success.stdout).status).toBe("valid");
  expect((await cli(["--help"])).stdout).toContain("Read-only");
  expect((await cli(["absent"])).code).toBe(1);
  for (const args of [
    [],
    [".", "--private"],
    [".", "--max-bytes", "private"],
    [".", "--max-bytes", "1", "--max-bytes", "2"]
  ]) {
    const result = await cli(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("private");
  }
});
