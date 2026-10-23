import { cleanupResource } from "../errors/resource-cleanup.js";

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
    await cleanupResource(cleanup, failure, message);
  }
}
