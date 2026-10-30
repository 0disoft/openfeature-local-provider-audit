import { getEventListeners } from "node:events";
import { expect, it, vi } from "vitest";
import { serializeProcessWrite } from "../../src/audit/audit-sink.js";

it.each([false, true])(
  "cancels admission without releasing earlier work or invoking cancelled work (failure %s)",
  async (failFirst) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = `cancelled-queue-${failFirst}`;
    const started: string[] = [];
    const first = serializeProcessWrite(path, async () => {
      started.push("first");
      await gate;
      if (failFirst) throw new Error("writer failed");
    });
    const controller = new AbortController();
    const reason = new Error("cancel queued work");
    const cancelledWork = vi.fn(async () => {});
    const cancelled = serializeProcessWrite(path, cancelledWork, controller.signal);
    const rejected = expect(cancelled).rejects.toBe(reason);
    try {
      await Promise.resolve();
      controller.abort(reason);
      // This must settle while the earlier operation is still blocked.
      await rejected;
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      const follower = serializeProcessWrite(path, async () => {
        started.push("follower");
      });
      await Promise.resolve();
      expect(started).toEqual(["first"]);
      release();
      const results = await Promise.allSettled([first, follower]);
      expect(results[0]?.status).toBe(failFirst ? "rejected" : "fulfilled");
      expect(results[1]?.status).toBe("fulfilled");
      expect(started).toEqual(["first", "follower"]);
      expect(cancelledWork).not.toHaveBeenCalled();
      await serializeProcessWrite(path, async () => {
        started.push("last");
      });
      expect(started).toEqual(["first", "follower", "last"]);
    } finally {
      release();
      await Promise.allSettled([first, cancelled]);
    }
  }
);

it("keeps admitted work in charge of its cancellation and cleanup", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const started: string[] = [];
  const finished = vi.fn();
  const first = serializeProcessWrite(
    "admitted-queue",
    async () => {
      started.push("first");
      await gate;
      started.push("cleanup");
    },
    controller.signal
  ).then(finished);
  const follower = serializeProcessWrite("admitted-queue", async () => {
    started.push("follower");
  });
  try {
    await Promise.resolve();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    controller.abort(new Error("cancel admitted work"));
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(started).toEqual(["first"]);
    release();
    await Promise.all([first, follower]);
    expect(finished).toHaveBeenCalledOnce();
    expect(started).toEqual(["first", "cleanup", "follower"]);
  } finally {
    release();
    await Promise.allSettled([first, follower]);
  }
});

it("rejects an already cancelled entry without invoking it", async () => {
  const reason = new Error("already cancelled");
  const operation = vi.fn(async () => {});
  await expect(
    serializeProcessWrite("preaborted-queue", operation, AbortSignal.abort(reason))
  ).rejects.toBe(reason);
  expect(operation).not.toHaveBeenCalled();
});
