// Keep the original failure when cleanup succeeds, and retain both when it fails.
export async function withAuditCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  message: string
): Promise<T> {
  let failure: { cause: unknown } | undefined;
  try {
    return await operation();
  } catch (error) {
    failure = { cause: error };
    throw error;
  } finally {
    await cleanupAuditResource(cleanup, failure, message);
  }
}

// Async generators cannot wrap their yield loop in an operation callback.
export async function cleanupAuditResource(
  cleanup: () => Promise<void>,
  failure: { readonly cause: unknown } | undefined,
  message: string
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    if (failure !== undefined)
      throw new AggregateError([failure.cause, error], message, { cause: failure.cause });
    throw error;
  }
}
