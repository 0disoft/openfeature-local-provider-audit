import { parseDocument } from "yaml";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type { FlagSnapshot } from "../public-types.js";
import { validateFlagSnapshot } from "./validate-snapshot.js";

export function parseYamlFlagSnapshot(yaml: string): FlagSnapshot {
  const document = parseDocument(yaml, {
    merge: false,
    prettyErrors: false,
    uniqueKeys: true
  });

  if (document.errors.length > 0) {
    throw new LocalProviderError(
      LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
      "Flag snapshot YAML could not be parsed."
    );
  }

  return validateFlagSnapshot(document.toJSON());
}
