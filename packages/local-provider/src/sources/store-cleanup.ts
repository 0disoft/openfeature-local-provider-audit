import { failureCause } from "./failure-cause.js";

// Complete cleanup before rethrowing. Only trusted diagnostics receive raw causes;
// public load/commit boundaries sanitize the result after this function settles.
export async function withStoreCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  message: string
): Promise<T> {
  let value!: T;
  let failure: { cause: unknown } | undefined;
  try {
    value = await operation();
  } catch (error) {
    failure = { cause: error };
  }
  try {
    await cleanup();
  } catch (error) {
    if (failure !== undefined) {
      const cause = failureCause(failure.cause);
      throw new AggregateError([cause, failureCause(error)], message, { cause });
    }
    throw error;
  }
  if (failure !== undefined) throw failure.cause;
  return value;
}
