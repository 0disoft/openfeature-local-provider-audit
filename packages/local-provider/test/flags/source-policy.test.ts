import { expect, it, vi } from "vitest";
import { createReadPolicy, readWithPolicy } from "../../src/sources/source-policy.js";

const transient = new Error("transient");
const cancelled = () => new Error("cancelled");
const timedOut = () => new Error("total deadline");

it("shares one monotonic budget across reads and jittered backoff", async () => {
  let now = 0;
  const timeouts: number[] = [],
    sleeps: number[] = [];
  const read = vi.fn(async (timeout: number) => {
    timeouts.push(timeout);
    now += timeout;
    throw transient;
  });
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({ timeoutMs: 40, totalTimeoutMs: 100, retryDelayMs: 100 }),
        signal: undefined,
        read,
        retryable: (e) => e === transient,
        cancelled,
        timedOut
      },
      {
        now: () => now,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        }
      }
    )
  ).rejects.toThrow("total deadline");
  expect(timeouts).toEqual([40, 10]);
  expect(sleeps).toEqual([50]);
});

it("caps the attempt count even with zero jitter and immediate failures", async () => {
  const read = vi.fn(async () => {
    throw transient;
  });
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({ maxAttempts: 3 }),
        signal: undefined,
        read,
        retryable: () => true,
        cancelled,
        timedOut
      },
      { now: () => 0, random: () => 0, sleep: async () => {} }
    )
  ).rejects.toBe(transient);
  expect(read).toHaveBeenCalledTimes(3);
});

it("does not retry permanent failures or deliberately cancelled work", async () => {
  const read = vi.fn(async () => {
    throw transient;
  });
  await expect(
    readWithPolicy({
      policy: createReadPolicy({}),
      signal: undefined,
      read,
      retryable: () => false,
      cancelled,
      timedOut
    })
  ).rejects.toBe(transient);
  expect(read).toHaveBeenCalledOnce();
  const controller = new AbortController();
  read.mockClear();
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({}),
        signal: controller.signal,
        read,
        retryable: () => true,
        cancelled,
        timedOut
      },
      {
        now: () => 0,
        random: () => 0.5,
        sleep: async () => {
          controller.abort();
          throw new Error("abort");
        }
      }
    )
  ).rejects.toThrow("cancelled");
  expect(read).toHaveBeenCalledOnce();
});

it("does not accept a result delivered after the overall deadline", async () => {
  let now = 0;
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({ totalTimeoutMs: 1 }),
        signal: undefined,
        read: async () => {
          now = 2;
          return "late";
        },
        retryable: () => false,
        cancelled,
        timedOut
      },
      { now: () => now, random: () => 0, sleep: async () => {} }
    )
  ).rejects.toThrow("total deadline");
});

it.each([9.999, 10, 10.001])(
  "enforces the per-attempt completion boundary at %s ms",
  async (elapsed) => {
    let now = 100;
    const timeout = new Error("attempt deadline");
    const read = vi.fn(async () => {
      now += elapsed;
      return "content";
    });
    const result = readWithPolicy(
      {
        policy: createReadPolicy({ timeoutMs: 10, totalTimeoutMs: 1000, maxAttempts: 1 }),
        signal: undefined,
        read,
        retryable: () => true,
        cancelled,
        timedOut: () => timeout
      },
      { now: () => now, random: () => 0, sleep: async () => {} }
    );
    if (elapsed < 10) await expect(result).resolves.toBe("content");
    else await expect(result).rejects.toBe(timeout);
    expect(read).toHaveBeenCalledExactlyOnceWith(10);
  }
);

it("starts a fresh attempt budget after bounded backoff and rejects only the late result", async () => {
  let now = 100,
    attempts = 0;
  const sleeps: number[] = [];
  const timeout = new Error("attempt deadline");
  const read = vi.fn(async () => {
    now += ++attempts === 1 ? 10 : 9;
    return attempts;
  });
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({
          timeoutMs: 10,
          totalTimeoutMs: 100,
          retryDelayMs: 10,
          maxAttempts: 2
        }),
        signal: undefined,
        read,
        retryable: (cause) => cause === timeout,
        cancelled,
        timedOut: () => timeout
      },
      {
        now: () => now,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        }
      }
    )
  ).resolves.toBe(2);
  expect(read.mock.calls).toEqual([[10], [10]]);
  expect(sleeps).toEqual([5]);
});

it("caps retries of over-budget completions while the total budget still has room", async () => {
  let now = 0;
  const timeout = new Error("attempt deadline");
  const read = vi.fn(async () => {
    now += 6;
    return "late";
  });
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({
          timeoutMs: 5,
          totalTimeoutMs: 1000,
          maxAttempts: 3,
          retryDelayMs: 0
        }),
        signal: undefined,
        read,
        retryable: (cause) => cause === timeout,
        cancelled,
        timedOut: () => timeout
      },
      { now: () => now, random: () => 0, sleep: async () => {} }
    )
  ).rejects.toBe(timeout);
  expect(read).toHaveBeenCalledTimes(3);
});

it("gives caller cancellation precedence over an over-budget completion", async () => {
  let now = 0;
  const controller = new AbortController();
  const read = vi.fn(async () => {
    now = 20;
    controller.abort();
    return "late";
  });
  await expect(
    readWithPolicy(
      {
        policy: createReadPolicy({ timeoutMs: 10, totalTimeoutMs: 1000 }),
        signal: controller.signal,
        read,
        retryable: () => true,
        cancelled,
        timedOut
      },
      { now: () => now, random: () => 0, sleep: async () => {} }
    )
  ).rejects.toThrow("cancelled");
  expect(read).toHaveBeenCalledOnce();
});

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 320_001])(
  "rejects invalid total deadline %s",
  (totalTimeoutMs) => {
    expect(() => createReadPolicy({ totalTimeoutMs })).toThrow(RangeError);
  }
);
