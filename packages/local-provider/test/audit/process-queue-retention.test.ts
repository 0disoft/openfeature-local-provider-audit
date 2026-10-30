import { afterEach, expect, it, vi } from "vitest";
import { serializeProcessWrite } from "../../src/audit/audit-sink.js";

afterEach(() => vi.restoreAllMocks());

it.each([1, 1_000])(
  "does not revisit %s cancelled entries when a blocked writer finishes",
  async (count) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const path = `retention-${count}`;
    const first = serializeProcessWrite(path, () => gate);
    const cancelledWork = vi.fn(async () => {});
    const checked = vi.spyOn(AbortSignal.prototype, "throwIfAborted");
    const reason = new Error("cancel pending export");
    const controllers = Array.from({ length: count }, () => new AbortController());
    const pending = controllers.map((controller) =>
      serializeProcessWrite(path, cancelledWork, controller.signal)
    );
    const settled = Promise.allSettled(pending);
    try {
      for (const controller of controllers) controller.abort(reason);
      expect(await settled).toEqual(
        Array.from({ length: count }, () => ({ status: "rejected", reason }))
      );
      checked.mockClear();
      const follower = vi.fn(async () => {});
      const next = serializeProcessWrite(path, follower);
      expect(follower).not.toHaveBeenCalled();
      release();
      await Promise.all([first, next]);
      expect(follower).toHaveBeenCalledOnce();
      expect(cancelledWork).not.toHaveBeenCalled();
      // Draining must depend on live work, not the number of past cancellations.
      expect(checked.mock.calls.length).toBe(0);
    } finally {
      release();
      await first;
      await settled;
    }
  }
);

it("preserves live FIFO order after cancelling head, middle and tail entries", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const path = "mixed-retention";
  const first = serializeProcessWrite(path, () => gate);
  const started: number[] = [];
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const failure = new Error("live writer failed");
  const pending = controllers.map((controller, index) =>
    serializeProcessWrite(
      path,
      async () => {
        started.push(index);
        if (index === 3) throw failure;
      },
      controller.signal
    )
  );
  const settled = Promise.allSettled(pending);
  try {
    for (const index of [2, 0, 5, 1]) controllers[index]?.abort();
    const follower = serializeProcessWrite(path, async () => {
      started.push(6);
    });
    await Promise.resolve();
    expect(started).toEqual([]);
    release();
    await Promise.all([first, follower]);
    const results = await settled;
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "fulfilled",
      "rejected"
    ]);
    expect(results[3]).toEqual({ status: "rejected", reason: failure });
    expect(started).toEqual([3, 4, 6]);
  } finally {
    release();
    await first;
    await settled;
  }
});

it("admits new work after all entries were cancelled before the drain started", async () => {
  const controller = new AbortController();
  const cancelledWork = vi.fn(async () => {});
  const cancelled = serializeProcessWrite("empty-retention", cancelledWork, controller.signal);
  const settled = Promise.allSettled([cancelled]);
  controller.abort();
  const follower = vi.fn(async () => {});
  await serializeProcessWrite("empty-retention", follower);
  expect((await settled)[0]?.status).toBe("rejected");
  expect(cancelledWork).not.toHaveBeenCalled();
  expect(follower).toHaveBeenCalledOnce();
});
