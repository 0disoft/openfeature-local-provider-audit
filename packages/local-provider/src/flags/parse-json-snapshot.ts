import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type { FlagSnapshot } from "../public-types.js";
import { validateFlagSnapshot } from "./validate-snapshot.js";

export function parseJsonFlagSnapshot(json: string): FlagSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LocalProviderError(
      LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
      "Flag snapshot JSON could not be parsed."
    );
  }

  return validateFlagSnapshot(parsed);
}
