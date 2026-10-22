import { LocalProviderError } from "../errors/local-provider-error.js";
import { retainFailureCause } from "./failure-cause.js";

// Stop waiting without letting an abort-ignoring operation resume its caller.
// Both late outcomes remain observed; the operation still owns its I/O cleanup.
export function waitForSnapshotOperation<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(
        retainFailureCause(new LocalProviderError("PROVIDER_NOT_READY", message), signal.reason)
      );
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      void Promise.resolve(operation()).then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        }
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
