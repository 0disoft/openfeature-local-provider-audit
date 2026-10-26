import { mkdtemp, readFile, rm } from "node:fs/promises";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFileAuditSink } from "../../src/audit/audit-sink.js";
import { createAuditEvent, serializeAuditEvent } from "../../src/audit/audit-event.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import type { AuditEvent } from "../../src/public-types.js";
import { staticSnapshot } from "../fixtures.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const request = {
  flagKey: "checkout.enabled",
  expectedType: "boolean" as const,
  defaultValue: false
};
const base = createAuditEvent({
  providerName: "batch-test",
  snapshot: staticSnapshot,
  request,
  result: evaluateFlag(staticSnapshot, request),
  eventId: "base",
  timestamp: "2026-10-25T00:00:00.000Z"
});
const event = (eventId: string): AuditEvent => ({ ...base, eventId });
let directory: string;
let path: string;
let handles: FileHandle[];
let originalCloses: WeakMap<FileHandle, () => Promise<void>>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-file-batch-"));
  path = join(directory, "audit.jsonl");
  handles = [];
  originalCloses = new WeakMap();
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (args[0] === path) {
      handles.push(handle);
      originalCloses.set(handle, handle.close.bind(handle));
      vi.spyOn(handle, "appendFile");
      vi.spyOn(handle, "close");
    }
    return handle;
  });
});
afterEach(async () => {
  await Promise.allSettled(
    handles.filter((handle) => handle.fd >= 0).map((handle) => originalCloses.get(handle)?.())
  );
  vi.restoreAllMocks();
  vi.mocked(open).mockClear();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-file-batch-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

it.each([
  { confirmed: false, policy: "batch", settings: {} },
  { confirmed: true, policy: "batch", settings: {} },
  { confirmed: false, policy: "rotation", settings: { maxBytes: 10_000 } },
  { confirmed: true, policy: "lock", settings: { lock: true } }
])(
  "captures $policy confirmed=$confirmed input once before enqueue",
  async ({ confirmed, settings }) => {
    const marker = "one-capture";
    const input = event(marker);
    const expected = serializeAuditEvent(input);
    const ownKeys = Reflect.ownKeys;
    let captures = 0;
    vi.spyOn(Reflect, "ownKeys").mockImplementation((target) => {
      if (Object.getOwnPropertyDescriptor(target, "eventId")?.value === marker) captures++;
      return ownKeys(target);
    });
    const sink = createFileAuditSink({ path, ...settings });
    const writing = confirmed ? sink.writeConfirmed?.(input) : sink.write(input);
    Object.assign(input, { eventId: "mutated-after-enqueue" });
    await writing;
    await sink.flush?.();
    expect(captures).toBe(1);
    expect(await readFile(path, "utf8")).toBe(expected);
  }
);

it("never treats a frozen caller object as a validated capture", async () => {
  const getter = vi.fn(() => {
    throw new Error("caller getter must not run");
  });
  const input = Object.freeze(Object.defineProperty(event("frozen"), "toJSON", { get: getter }));
  const sink = createFileAuditSink({ path });
  expect(() => serializeAuditEvent(input)).toThrow("invalid or unsupported fields");
  await expect(sink.write(input)).rejects.toThrow("invalid or unsupported fields");
  await expect(sink.writeConfirmed?.(input)).rejects.toThrow("invalid or unsupported fields");
  expect(getter).not.toHaveBeenCalled();
  expect(handles).toHaveLength(0);
});

it("coalesces 128 confirmed records into two append/close operations, preserving FIFO", async () => {
  const sink = createFileAuditSink({ path });
  const records = Array.from({ length: 128 }, (_, index) => event(String(index)));
  await Promise.all(records.map((record) => sink.writeConfirmed?.(record)));
  await sink.flush?.();
  expect(handles).toHaveLength(2);
  for (const handle of handles) {
    expect(handle.appendFile).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
  }
  expect(
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).eventId)
  ).toEqual(records.map((record) => record.eventId));
  expect(sink.getStats?.()).toMatchObject({ pendingWrites: 0, pendingBytes: 0 });
});

it.each([
  { unit: "a", excess: 0 },
  { unit: "a", excess: 1 },
  { unit: "가", excess: 0 },
  { unit: "가", excess: 1 }
])("enforces UTF-8 batch bytes for $unit with $excess byte excess", async ({ unit, excess }) => {
  const overhead = Buffer.byteLength(serializeAuditEvent(event("")));
  const sized = (total: number) => {
    const bytes = total - overhead;
    const width = Buffer.byteLength(unit);
    return event(unit.repeat(Math.floor(bytes / width)) + "x".repeat(bytes % width));
  };
  const records = [sized(32768), sized(32768 + excess)];
  const sink = createFileAuditSink({ path });
  await Promise.all(records.map((record) => sink.write(record)));
  expect(handles).toHaveLength(excess === 0 ? 1 : 2);
  expect(await readFile(path, "utf8")).toBe(records.map(serializeAuditEvent).join(""));
});

it("allows a record larger than the batch budget as an isolated singleton", async () => {
  const records = [event("a"), event("x".repeat(70_000)), event("b")];
  const sink = createFileAuditSink({ path });
  await Promise.all(records.map((record) => sink.write(record)));
  expect(handles).toHaveLength(3);
  expect(await readFile(path, "utf8")).toBe(records.map(serializeAuditEvent).join(""));
});

it.each([{ maxBytes: 1_000_000 }, { lock: true }])(
  "retains record writes for rotation/lock configuration %j",
  async (policy) => {
    const sink = createFileAuditSink({ path, ...policy });
    await Promise.all(["a", "b", "c"].map((id) => sink.write(event(id))));
    expect(handles).toHaveLength(3);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(3);
  }
);

it("keeps confirmations pending until the shared close completes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let entered!: () => void;
  const closing = new Promise<void>((done) => {
    entered = done;
  });
  const original = vi.mocked(open).getMockImplementation();
  if (original === undefined) throw new Error("Open instrumentation is unavailable.");
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await original(...args);
    const close = originalCloses.get(handle);
    if (close === undefined) throw new Error("Close instrumentation is unavailable.");
    vi.mocked(handle.close).mockImplementationOnce(async () => {
      entered();
      await gate;
      await close();
    });
    return handle;
  });
  const sink = createFileAuditSink({ path });
  let confirmed = 0;
  const confirm = sink.writeConfirmed?.bind(sink);
  if (confirm === undefined) throw new Error("File confirmations are unavailable.");
  const writes = ["a", "b"].map((id) =>
    confirm(event(id)).then(() => {
      confirmed++;
    })
  );
  await closing;
  expect(confirmed).toBe(0);
  expect(sink.getStats?.().pendingWrites).toBe(2);
  release();
  await Promise.all(writes);
  expect(confirmed).toBe(2);
});

it("retains per-record failures on a shared append error, closes once and never retries", async () => {
  const failure = new Error("disk failure");
  const original = vi.mocked(open).getMockImplementation();
  if (original === undefined) throw new Error("Open instrumentation is unavailable.");
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (handles.length === 1) vi.mocked(handle.appendFile).mockRejectedValueOnce(failure);
    return handle;
  });
  const sink = createFileAuditSink({ path });
  const results = await Promise.allSettled(["a", "b", "c"].map((id) => sink.write(event(id))));
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
  expect(handles).toHaveLength(1);
  expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  await expect(sink.flush?.()).rejects.toMatchObject({ errors: [failure, failure, failure] });
  await expect(sink.flush?.()).resolves.toBeUndefined();
  await sink.writeConfirmed?.(event("recovered"));
  expect(handles).toHaveLength(2);
  expect(
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).eventId)
  ).toEqual(["recovered"]);
});

it("retains both append and close failures for each batch member and releases the handle once", async () => {
  const writeError = new Error("append failed"),
    closeError = new Error("close failed");
  const original = vi.mocked(open).getMockImplementation();
  if (original === undefined) throw new Error("Open instrumentation is unavailable.");
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await original(...args);
    const close = originalCloses.get(handle);
    if (close === undefined) throw new Error("Close instrumentation is unavailable.");
    vi.mocked(handle.appendFile).mockRejectedValueOnce(writeError);
    vi.mocked(handle.close).mockImplementationOnce(async () => {
      await close();
      throw closeError;
    });
    return handle;
  });
  const sink = createFileAuditSink({ path });
  const results = await Promise.allSettled(["a", "b", "c"].map((id) => sink.write(event(id))));
  for (const result of results)
    expect(result).toMatchObject({
      status: "rejected",
      reason: { errors: [writeError, closeError], cause: writeError }
    });
  expect(handles).toHaveLength(1);
  expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  expect(sink.getStats?.()).toMatchObject({ pendingWrites: 0, pendingBytes: 0 });
  await expect(sink.flush?.()).rejects.toThrow("3 audit writes failed");
});
