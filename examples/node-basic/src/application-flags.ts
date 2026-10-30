import { OpenFeature } from "@openfeature/server-sdk";
import {
  createWatchedLocalProvider,
  type WatchedLocalProviderOptions
} from "@0disoft/openfeature-local-provider";
import { ownRuntime } from "./runtime-owner.js";

// Copy into server-only application code. No framework or process signal ownership.
export function createApplicationFlags(domain: string, options: WatchedLocalProviderOptions) {
  if (!domain.trim()) throw new TypeError("Use a nonempty application-owned OpenFeature domain.");
  const owner = ownRuntime(async () => {
    const runtime = await createWatchedLocalProvider(options);
    try {
      await OpenFeature.setProviderAndWait(domain, runtime.provider);
      return { client: OpenFeature.getClient(domain), close: runtime.close };
    } catch (cause) {
      try {
        await runtime.close();
      } catch (cleanup) {
        throw new AggregateError([cause, cleanup], "Flag setup and cleanup failed.");
      }
      throw cause;
    }
  });
  return {
    async getClient() {
      return (await owner.ready()).client;
    },
    close: owner.close
  };
}
