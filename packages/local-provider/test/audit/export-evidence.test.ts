import { existsSync, constants } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createChainedFileAuditSink,
  createAuditEvent,
  evaluateFlag,
  exportChainedAuditEvidence
} from "../../src/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string, directory: string, destination: string;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function event(large = false) {
  const snapshot = { schemaVersion: 1 as const, flags: {} };
  const request = { flagKey: "feature", expectedType: "boolean" as const, defaultValue: false };
  return createAuditEvent({
    snapshot,
    request,
    result: evaluateFlag(snapshot, request),
    providerName: large ? "x".repeat(160_000) : "export-test"
  });
}
async function prepare(options = {}) {
  const sink = createChainedFileAuditSink({ directory, chainId: "test/export", ...options });
  await sink.writeConfirmed?.(event());
  return sink;
}
async function capture() {
  return Promise.all(
    (await readdir(directory)).sort().map(async (name) => {
      const path = join(directory, name),
        stats = await lstat(path, { bigint: true });
      return {
        name,
        bytes: Number(stats.size),
        hash: digest(await readFile(path)),
        mtimeNs: stats.mtimeNs
      };
    })
  );
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "of-evidence-export-"));
  directory = join(root, "source");
  destination = join(root, "export");
  vi.mocked(open).mockImplementation(actual.open);
  vi.mocked(rename).mockImplementation(actual.rename);
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(resolve(root).startsWith(join(resolve(tmpdir()), "of-evidence-export-"))).toBe(true);
  await rm(root, { recursive: true, force: true });
});

it("exports exact source bytes and matched checkpoints, including multi-chunk records", async () => {
  const sink = await prepare();
  await sink.writeConfirmed?.(event(true));
  const before = await capture();
  vi.mocked(open).mockClear();
  const result = await exportChainedAuditEvidence({ directory, destination });
  expect(result).toMatchObject({
    schemaVersion: 1,
    checkpointAuthenticated: false,
    records: 2,
    start: { sequence: 0 },
    head: { sequence: 2 }
  });
  expect(result.sourceBytes).toBe(before.reduce((sum, file) => sum + file.bytes, 0));
  expect(await capture()).toEqual(before);
  expect(JSON.parse(await readFile(join(destination, "evidence.json"), "utf8"))).toEqual(result);
  for (const file of result.files) {
    const bytes = await readFile(join(destination, file.name));
    expect(bytes.length).toBe(file.bytes);
    expect(digest(bytes)).toBe(file.sha256);
  }
  for (const [, flags] of vi
    .mocked(open)
    .mock.calls.filter(
      ([path]) => String(path).startsWith(directory) && !String(path).endsWith(".lock")
    )) {
    expect(
      (flags as number) &
        (constants.O_RDWR |
          constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_TRUNC |
          constants.O_APPEND)
    ).toBe(0);
  }
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.files)).toBe(true);
  expect(Object.isFrozen(result.files[0])).toBe(true);
});

it("exports retained suffixes from their actual retained start", async () => {
  const sink = await prepare({ maxSegmentBytes: 1, maxSegments: 1 });
  await sink.writeConfirmed?.(event());
  const result = await exportChainedAuditEvidence({ directory, destination });
  expect(result).toMatchObject({ records: 1, start: { sequence: 1 }, head: { sequence: 2 } });
  expect(result.files.map((file) => file.name)).toContain("segment-2.jsonl");
});

it("supports a committed empty manifest without initializing missing source storage", async () => {
  await mkdir(directory);
  await expect(exportChainedAuditEvidence({ directory, destination })).rejects.toMatchObject({
    code: "AUDIT_SINK_ERROR"
  });
  expect(await readdir(directory)).toEqual([]);
  expect(existsSync(destination)).toBe(false);
  const sink = createChainedFileAuditSink({ directory, chainId: "empty" });
  await sink.getCheckpoint();
  expect(await exportChainedAuditEvidence({ directory, destination })).toMatchObject({
    records: 0,
    start: { sequence: 0 },
    head: { sequence: 0 }
  });
});

it.each([-1, 0])("honors the inclusive source-byte cap (delta %s)", async (delta) => {
  await prepare();
  const maxBytes = (await capture()).reduce((sum, file) => sum + file.bytes, 0) + delta;
  const operation = exportChainedAuditEvidence({ directory, destination, maxBytes });
  if (delta < 0) {
    await expect(operation).rejects.toMatchObject({ code: "AUDIT_SINK_ERROR" });
    expect(existsSync(destination)).toBe(false);
  } else expect((await operation).sourceBytes).toBe(maxBytes);
});

it.each(["records", "corrupt", "tail", "orphan"])(
  "withholds the completion marker for %s failures and preserves originals",
  async (kind) => {
    await prepare();
    const path = join(directory, "segment-1.jsonl");
    if (kind === "corrupt") {
      const bytes = await readFile(path);
      bytes[0] = 0;
      await writeFile(path, bytes);
    }
    if (kind === "tail") await appendFile(path, "uncommitted evidence");
    if (kind === "orphan") await writeFile(join(directory, "segment-10.jsonl"), "orphan evidence");
    const before = await capture();
    await expect(
      exportChainedAuditEvidence({
        directory,
        destination,
        ...(kind === "records" ? { maxRecords: 0 } : {})
      })
    ).rejects.toMatchObject({ code: "AUDIT_SINK_ERROR" });
    expect(existsSync(join(destination, "evidence.json"))).toBe(false);
    expect(await capture()).toEqual(before);
  }
);

it("does not steal an existing lock or create a destination on lock timeout", async () => {
  await prepare();
  await writeFile(join(directory, "manifest.json.lock"), "operator-owned fixture");
  const before = await capture();
  await expect(
    exportChainedAuditEvidence({ directory, destination, lockTimeoutMs: 0 })
  ).rejects.toMatchObject({ code: "AUDIT_SINK_ERROR" });
  expect(await capture()).toEqual(before);
  expect(existsSync(destination)).toBe(false);
});

it.each(["existing", "same", "nested", "alias"])(
  "rejects %s destinations without overwriting evidence",
  async (kind) => {
    await prepare();
    let target = destination;
    if (kind === "existing") {
      await mkdir(target);
      await writeFile(join(target, "keep"), "previous evidence");
    }
    if (kind === "same") target = directory;
    if (kind === "nested") target = join(directory, "nested");
    if (kind === "alias") {
      const alias = join(root, "alias");
      await symlink(directory, alias, "junction");
      target = join(alias, "nested");
    }
    const before = await capture();
    await expect(
      exportChainedAuditEvidence({ directory, destination: target })
    ).rejects.toMatchObject({ code: "AUDIT_SINK_ERROR" });
    expect(await capture()).toEqual(before);
    if (kind === "existing")
      expect(await readFile(join(destination, "keep"), "utf8")).toBe("previous evidence");
  }
);

it("closes both copy handles and releases the lock on cancellation", async () => {
  await prepare();
  const controller = new AbortController(),
    reason = new Error("caller cancellation");
  const closed: string[] = [];
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args),
      path = String(args[0]);
    if (path.endsWith("segment-1.jsonl")) {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closed.push(path);
        await close();
      });
      if (path.startsWith(destination)) {
        vi.spyOn(handle, "writeFile").mockImplementation(async () => {
          controller.abort(reason);
          throw reason;
        });
      }
    }
    return handle;
  });
  await expect(
    exportChainedAuditEvidence({ directory, destination, signal: controller.signal })
  ).rejects.toBe(reason);
  expect(closed).toEqual([
    join(destination, "segment-1.jsonl"),
    join(directory, "segment-1.jsonl")
  ]);
  expect(existsSync(join(directory, "manifest.json.lock"))).toBe(false);
  expect(existsSync(join(destination, "evidence.json"))).toBe(false);
});

it("preserves trusted diagnostic causes while isolating rejected observers", async () => {
  await prepare();
  const failure = new Error("private destination failure");
  vi.mocked(rename).mockRejectedValueOnce(failure);
  const onError = vi.fn(async () => {
    throw new Error("diagnostic failure");
  });
  await expect(
    exportChainedAuditEvidence({ directory, destination, onError })
  ).rejects.toMatchObject({
    code: "AUDIT_SINK_ERROR",
    message: "Audit evidence export failed; incomplete output may remain."
  });
  expect(onError).toHaveBeenCalledWith(failure);
  expect(existsSync(join(directory, "manifest.json.lock"))).toBe(false);
  expect(existsSync(join(destination, "evidence.json"))).toBe(false);
});

it("keeps a copied checkpoint stable across concurrent source rotation", async () => {
  const sink = await prepare({ maxSegmentBytes: 1, maxSegments: 1 });
  let nextWrite: Promise<void> | undefined;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]) === join(destination, "segment-1.jsonl") && args[1] === "wx") {
      expect(existsSync(join(directory, "manifest.json.lock"))).toBe(true);
      nextWrite = sink.writeConfirmed?.(event());
    }
    return handle;
  });
  const result = await exportChainedAuditEvidence({ directory, destination });
  await nextWrite;
  expect(result.head.sequence).toBe(1);
  expect(existsSync(join(directory, "segment-1.jsonl"))).toBe(false);
  expect(existsSync(join(destination, "segment-1.jsonl"))).toBe(true);
  expect((await sink.getCheckpoint()).head.sequence).toBe(2);
});

it("propagates already requested cancellation without touching storage", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  await expect(
    exportChainedAuditEvidence({ directory, destination, signal: controller.signal })
  ).rejects.toBe(reason);
  expect(await readdir(root)).toEqual([]);
});
