import { expect, it, vi } from "vitest";
import { createQueuedAuditSink } from "../../src/audit/queued-sink.js";
import type { AuditEvent } from "../../src/public-types.js";

const event = (eventId: string) => ({ eventId }) as AuditEvent;

it("keeps FIFO and queue reservations through batch failure, then continues without retry", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failure = new Error("ambiguous batch");
  const groups: string[][] = [];
  const write = vi.fn(async (events: readonly AuditEvent[]) => {
    groups.push(events.map((value) => value.eventId));
    if (groups.length === 1) {
      await gate;
      throw failure;
    }
  });
  const sink = createQueuedAuditSink({ path: "unused" }, vi.fn(), {
    maxSize: 2,
    maxBytes: 1024,
    write
  });
  const writes = [sink.write(event("a")), sink.write(event("b")), sink.write(event("c"))];
  const results = Promise.allSettled(writes);
  await Promise.resolve();
  expect(groups).toEqual([["a", "b"]]);
  expect(sink.getStats?.()).toMatchObject({ pendingWrites: 3 });
  release();
  expect((await results).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
    "fulfilled"
  ]);
  expect(groups).toEqual([["a", "b"], ["c"]]);
  expect(sink.getStats?.()).toMatchObject({ pendingWrites: 0, pendingBytes: 0 });
  await expect(sink.flush?.()).rejects.toThrow("2 audit writes failed");
  await expect(sink.flush?.()).resolves.toBeUndefined();
});

it("uses exact queued-byte limits, permits a larger singleton, and drains arrivals during I/O", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const groups: string[][] = [];
  const value = event("a");
  const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
  const sink = createQueuedAuditSink({ path: "unused" }, vi.fn(), {
    maxSize: 64,
    maxBytes: bytes * 2,
    async write(events) {
      groups.push(events.map((entry) => entry.eventId));
      if (groups.length === 1) await gate;
    }
  });
  const first = [sink.write(value), sink.write(event("b")), sink.write(event("c"))];
  await Promise.resolve();
  const more = [sink.write(event("oversized")), sink.write(event("d"))];
  release();
  await Promise.all([...first, ...more]);
  expect(groups).toEqual([["a", "b"], ["c"], ["oversized"], ["d"]]);
  await sink.write(event("restart"));
  expect(groups.at(-1)).toEqual(["restart"]);
  expect(sink.getStats?.()).toMatchObject({ pendingWrites: 0, pendingBytes: 0 });
});
