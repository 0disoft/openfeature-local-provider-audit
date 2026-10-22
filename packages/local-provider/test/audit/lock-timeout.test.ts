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
