// Preserve a single failure; retain both in operation/cleanup order when they coincide.
export async function cleanupResource(
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
