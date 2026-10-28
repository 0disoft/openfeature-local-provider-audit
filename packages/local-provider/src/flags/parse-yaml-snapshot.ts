import { type Document, isAlias, isMap, isScalar, parseDocument, visit } from "yaml";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type { FlagSnapshot } from "../public-types.js";
import { validateFlagSnapshot } from "./validate-snapshot.js";

export function parseYamlFlagSnapshot(yaml: string): FlagSnapshot {
  try {
    const document = parseDocument(yaml, {
      merge: false,
      prettyErrors: false,
      // The JSON-key guard below rejects duplicates without the parser's quadratic scan.
      uniqueKeys: false
    });

    if (document.errors.length > 0) {
      throw yamlParseError();
    }

    assertUniqueObjectKeys(document);
    return validateFlagSnapshot(document.toJSON());
  } catch (error) {
    if (error instanceof LocalProviderError) {
      throw error;
    }
    throw yamlParseError();
  }
}

function assertUniqueObjectKeys(document: Document): void {
  const anchors = new Map<string, unknown>();
  const names = new WeakMap<object, Set<string>>();
  visit(document, {
    Node(_key, node) {
      // Follow document order, including redefined anchors, without expanding aliases.
      if (!isAlias(node) && node.anchor !== undefined) anchors.set(node.anchor, node);
    },
    Pair(_key, pair, path) {
      const parent = path[path.length - 1];
      if (!isMap(parent)) return;
      const key = isAlias(pair.key) ? anchors.get(pair.key.source) : pair.key;
      // JSON has no collection keys; implicit YAML stringification can lose entries.
      if (key !== null && !isScalar(key)) throw yamlParseError();
      const value = key === null ? null : key.toJSON();
      if (value !== null && typeof value === "object") throw yamlParseError();
      const name = value === null ? "" : String(value);
      const keys = names.get(parent) ?? new Set<string>();
      if (keys.has(name)) throw yamlParseError();
      keys.add(name);
      names.set(parent, keys);
    }
  });
}

function yamlParseError(): LocalProviderError {
  return new LocalProviderError(
    LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
    "Flag snapshot YAML could not be parsed."
  );
}
