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

// Synchronous watcher ownership must release siblings even if one cleanup throws.
export function cleanupResources(
  cleanups: readonly (() => void)[],
  message: string,
  failure?: { readonly cause: unknown }
): void {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 0) return;
  if (failure !== undefined) errors.unshift(failure.cause);
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message, { cause: errors[0] });
}
