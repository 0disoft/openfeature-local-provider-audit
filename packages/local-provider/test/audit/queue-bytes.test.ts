import { expect, it, vi } from "vitest";
import {
  createAuditEvent,
  createFileAuditSink,
  createChainedFileAuditSink,
  createLocalProvider,
  evaluateFlag
} from "../../src/index.js";
import { createQueuedAuditSink } from "../../src/audit/queued-sink.js";

function event() {
  const snapshot = { schemaVersion: 1 as const, flags: {} };
  const request = { flagKey: '雪\n"', defaultValue: false, expectedType: "boolean" as const };
  return createAuditEvent({
    snapshot,
    request,
    result: evaluateFlag(snapshot, request),
    providerName: "test",
    eventId: "fixed",
    timestamp: "2026-10-23T00:00:00.000Z"
  });
}
const bytes = () => Buffer.byteLength(JSON.stringify(event()), "utf8") + 1;

it.each(["resolve", "reject"])(
  "reserves exact UTF-8 JSON bytes until the actual write %s",
  async (outcome) => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const pending = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const writer = vi.fn(() => pending);
    const sink = createQueuedAuditSink(
      { path: "unused", maxQueueSize: null, maxQueueBytes: bytes() },
      writer
    );
    const first = sink.write(event());
    const observed = first.catch((error: unknown) => error);
    expect(sink.getStats?.()).toMatchObject({ pendingBytes: bytes(), pendingWrites: 1 });
    await expect(sink.write(event())).rejects.toThrow("maxQueueBytes");
    expect(sink.getStats?.()).toMatchObject({ pendingBytes: bytes(), rejectedWrites: 1 });
    const failure = new Error("writer failed");
    if (outcome === "resolve") resolve();
    else reject(failure);
    await observed;
    expect(sink.getStats?.()).toMatchObject({ pendingBytes: 0, pendingWrites: 0 });
    if (outcome === "reject") await expect(sink.flush?.()).rejects.toBe(failure);
    else await sink.flush?.();
    writer.mockResolvedValue(undefined);
    await expect(sink.write(event())).resolves.toBeUndefined();
    expect(writer).toHaveBeenCalledTimes(2);
  }
);

it("drops byte overflow only for unconfirmed writes and keeps count overflow precedence", async () => {
  const writer = vi.fn(async () => {});
  const sink = createQueuedAuditSink(
    { path: "unused", maxQueueBytes: bytes() - 1, queueOverflowPolicy: "dropNewest" },
    writer
  );
  await sink.write(event());
  await expect(sink.writeConfirmed?.(event())).rejects.toThrow("maxQueueBytes");
  expect(writer).not.toHaveBeenCalled();
  expect(sink.getStats?.()).toMatchObject({ pendingBytes: 0, droppedWrites: 1, rejectedWrites: 1 });
  const countSink = createQueuedAuditSink(
    { path: "unused", maxQueueSize: 1, maxQueueBytes: bytes() },
    async () => {}
  );
  const first = countSink.write(event());
  await expect(countSink.write(event())).rejects.toThrow("maxQueueSize=1");
  await first;
});

it("supports both limits independently and preserves FIFO", async () => {
  const order: string[] = [];
  const sink = createQueuedAuditSink(
    { path: "unused", maxQueueSize: null, maxQueueBytes: null },
    async (value) => {
      order.push(value.eventId);
    }
  );
  const writes = [sink.write(event()), sink.write({ ...event(), eventId: "next" })];
  await Promise.all(writes);
  expect(order).toEqual(["fixed", "next"]);
  expect(sink.getStats?.()).toMatchObject({ pendingBytes: 0, maxQueueBytes: null });
  const defaultSink = createFileAuditSink({ path: "unused" });
  expect(defaultSink.getStats?.()).toMatchObject({ maxQueueBytes: 64 * 1024 * 1024 });
  const stats = createLocalProvider({
    snapshot: { schemaVersion: 1, flags: {} },
    env: {},
    auditSink: defaultSink
  }).getStatus().audit.sinkStats;
  expect(stats).toMatchObject({ maxQueueBytes: 64 * 1024 * 1024, pendingBytes: 0 });
});

it.each(["plain", "chain"])(
  "wires byte limits through the %s file sink before any filesystem write",
  async (kind) => {
    const sink =
      kind === "plain"
        ? createFileAuditSink({ path: "unused", maxQueueBytes: bytes() - 1 })
        : createChainedFileAuditSink({
            directory: "unused",
            chainId: "test",
            maxQueueBytes: bytes() - 1
          });
    await expect(sink.write(event())).rejects.toThrow("maxQueueBytes");
    expect(sink.getStats?.()).toMatchObject({
      pendingBytes: 0,
      pendingWrites: 0,
      rejectedWrites: 1
    });
    await sink.flush?.();
  }
);

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid byte budget %s",
  (maxQueueBytes) => {
    expect(() => createFileAuditSink({ path: "unused", maxQueueBytes })).toThrow(RangeError);
  }
);
