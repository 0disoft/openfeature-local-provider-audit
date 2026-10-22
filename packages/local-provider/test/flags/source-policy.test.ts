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

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 320_001])(
  "rejects invalid total deadline %s",
  (totalTimeoutMs) => {
    expect(() => createReadPolicy({ totalTimeoutMs })).toThrow(RangeError);
  }
);
