import { open } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { acquireFileLock } from "../../src/audit/audit-sink.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
vi.mock("node:timers/promises", () => ({
  setTimeout: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(open).mockReset();
});

it.each([
  [24, true],
  [25, false],
  [26, false]
] as const)(
  "checks the retry deadline before opening a released lock at %d ms",
  async (wake, allowed) => {
    vi.useFakeTimers();
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    const identity = { dev: 1n, ino: 2n };
    vi.mocked(open)
      .mockRejectedValueOnce(Object.assign(new Error("held"), { code: "EEXIST" }))
      .mockResolvedValue({
        stat: async () => identity,
        writeFile: async () => {},
        close: async () => {}
      } as never);
    const acquired = vi.fn(),
      failed = vi.fn();
    const waiting = acquireFileLock({
      path: "released.lock",
      timeoutMs: 25,
      retryMs: 20,
      staleMs: undefined
    }).then(acquired, failed);
    await vi.advanceTimersByTimeAsync(0);
    tick = wake;
    await vi.advanceTimersByTimeAsync(20);
    await waiting;
    if (allowed) {
      expect(acquired).toHaveBeenCalledOnce();
      expect(failed).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(2);
      await acquired.mock.calls[0]?.[0]();
    } else {
      expect(acquired).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith(
        new Error("Timed out acquiring audit file lock: released.lock")
      );
      expect(open).toHaveBeenCalledOnce();
    }
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("limits retry sleep to the remaining lock wait budget", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.mocked(open).mockRejectedValue(Object.assign(new Error("held"), { code: "EEXIST" }));
  const failed = vi.fn();
  const waiting = acquireFileLock({
    path: "held.lock",
    timeoutMs: 5,
    retryMs: 20,
    staleMs: undefined
  }).catch(failed);
  await vi.advanceTimersByTimeAsync(5);
  expect(failed).toHaveBeenCalledWith(new Error("Timed out acquiring audit file lock: held.lock"));
  expect(open).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(20);
  await waiting;
});

it.each([-10_000, 10_000])(
  "preserves lock wait deadlines across a %s ms wall-clock change",
  async (jump) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let wallTime = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => wallTime);
    vi.mocked(open).mockRejectedValue(Object.assign(new Error("held"), { code: "EEXIST" }));
    const failed = vi.fn();
    const waiting = acquireFileLock({
      path: "operator-owned-audit.lock",
      timeoutMs: 40,
      retryMs: 20,
      staleMs: undefined
    }).catch(failed);
    await vi.advanceTimersByTimeAsync(0);
    wallTime += jump;
    await vi.advanceTimersByTimeAsync(20);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0]?.[0]?.message).toContain("Timed out acquiring audit file lock");
    await waiting;
  }
);
