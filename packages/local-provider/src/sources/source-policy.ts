import { setTimeout as delay } from "node:timers/promises";

export const DEFAULT_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_TIMEOUT_MS = 320_000;
const MAX_BACKOFF_MS = 5_000;

interface ReadPolicyOptions {
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

interface ReadPolicy {
  readonly timeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
}

export function createReadPolicy(options: ReadPolicyOptions): ReadPolicy {
  const timeoutMs = sourceInteger("timeoutMs", options.timeoutMs ?? 5_000, 1, 60_000);
  const maxAttempts = sourceInteger("maxAttempts", options.maxAttempts ?? 3, 1, 5);
  const retryDelayMs = sourceInteger(
    "retryDelayMs",
    options.retryDelayMs ?? 100,
    0,
    MAX_BACKOFF_MS
  );
  let defaultTotal = timeoutMs * maxAttempts;
  for (let attempt = 0; attempt < maxAttempts - 1; attempt++)
    defaultTotal += Math.min(MAX_BACKOFF_MS, retryDelayMs * 2 ** attempt);
  const totalTimeoutMs = sourceInteger(
    "totalTimeoutMs",
    options.totalTimeoutMs ?? defaultTotal,
    1,
    MAX_TOTAL_TIMEOUT_MS
  );
  return { timeoutMs, totalTimeoutMs, maxAttempts, retryDelayMs };
}

interface ReadOperation<T> {
  readonly policy: ReadPolicy;
  readonly signal: AbortSignal | undefined;
  readonly read: (timeoutMs: number) => Promise<T>;
  readonly retryable: (error: unknown) => boolean;
  readonly cancelled: () => Error;
  readonly timedOut: () => Error;
}

interface ReadRuntime {
  readonly now: () => number;
  readonly random: () => number;
  readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

const runtime: ReadRuntime = {
  now: () => performance.now(),
  random: () => Math.random(),
  sleep: (ms, signal) => delay(ms, undefined, { signal })
};

// Only transport reads belong here. Validation, persistence and activation never retry.
export async function readWithPolicy<T>(
  operation: ReadOperation<T>,
  clock: ReadRuntime = runtime
): Promise<T> {
  const { policy, signal } = operation;
  const deadline = clock.now() + policy.totalTimeoutMs;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw operation.cancelled();
    const started = clock.now();
    const remaining = deadline - started;
    if (remaining <= 0) throw operation.timedOut();
    const attemptDeadline = Math.min(deadline, started + policy.timeoutMs);
    try {
      const result = await operation.read(Math.min(policy.timeoutMs, Math.ceil(remaining)));
      if (signal?.aborted) throw operation.cancelled();
      // Timers may run late: completion must satisfy both attempt and total budgets.
      if (clock.now() >= attemptDeadline) throw operation.timedOut();
      return result;
    } catch (error) {
      if (signal?.aborted) throw operation.cancelled();
      if (!operation.retryable(error) || attempt + 1 >= policy.maxAttempts) throw error;
      const budget = deadline - clock.now();
      if (budget <= 0) throw operation.timedOut();
      const backoff = Math.min(MAX_BACKOFF_MS, policy.retryDelayMs * 2 ** attempt);
      try {
        await clock.sleep(Math.min(budget, Math.floor(clock.random() * backoff)), signal);
      } catch (error) {
        if (signal?.aborted) throw operation.cancelled();
        throw error;
      }
    }
  }
}

export function sourceInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

export function validEtag(value: string): boolean {
  return value.length <= 1_024 && /^(W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}
