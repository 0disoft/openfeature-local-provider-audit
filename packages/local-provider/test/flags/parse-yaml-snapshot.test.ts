import { describe, expect, it } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { isLocalProviderError } from "../../src/errors/local-provider-error.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { parseJsonFlagSnapshot } from "../../src/flags/parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "../../src/flags/parse-yaml-snapshot.js";

describe("parseYamlFlagSnapshot", () => {
  it("parses a valid schemaVersion 1 snapshot", () => {
    const snapshot = parseYamlFlagSnapshot(`
schemaVersion: 1
flags:
  checkout.enabled:
    type: boolean
    defaultVariant: "on"
    variants:
      "on": true
      "off": false
`);

    expect(snapshot.flags["checkout.enabled"]?.variants.on).toBe(true);
  });

  it("produces the same evaluation result as an equivalent JSON snapshot", () => {
    const jsonSnapshot = parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        flags: {
          "checkout.rollout": {
            type: "boolean",
            defaultVariant: "off",
            variants: {
              on: true,
              off: false
            },
            rollout: [
              {
                variant: "on",
                percentage: 50,
                seed: "checkout-rollout-v1"
              }
            ]
          }
        }
      })
    );
    const yamlSnapshot = parseYamlFlagSnapshot(`
schemaVersion: 1
flags:
  checkout.rollout:
    type: boolean
    defaultVariant: "off"
    variants:
      "on": true
      "off": false
    rollout:
      - variant: "on"
        percentage: 50
        seed: checkout-rollout-v1
`);

    const request = {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean" as const,
      targetingKey: "user-alpha"
    };

    expect(evaluateFlag(jsonSnapshot, request)).toEqual(evaluateFlag(yamlSnapshot, request));
  });

  it("throws PARSE_ERROR for invalid YAML", () => {
    try {
      parseYamlFlagSnapshot("schemaVersion: [");
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });

  it("throws PARSE_ERROR for duplicate keys", () => {
    try {
      parseYamlFlagSnapshot(`
schemaVersion: 1
schemaVersion: 1
flags: {}
`);
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });

  it("normalizes YAML alias exhaustion to PARSE_ERROR", () => {
    const aliases = Array.from({ length: 101 }, () => "  - *base").join("\n");

    try {
      parseYamlFlagSnapshot(`base: &base { value: true }\nrefs:\n${aliases}\n`);
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });

  it("throws SCHEMA_ERROR for invalid snapshot schema", () => {
    try {
      parseYamlFlagSnapshot(`
schemaVersion: 1
flags: []
`);
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });
});
