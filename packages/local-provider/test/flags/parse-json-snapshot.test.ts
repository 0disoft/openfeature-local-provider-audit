import { describe, expect, it } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { isLocalProviderError } from "../../src/errors/local-provider-error.js";
import { parseJsonFlagSnapshot } from "../../src/flags/parse-json-snapshot.js";

describe("parseJsonFlagSnapshot", () => {
  it("parses a valid schemaVersion 1 snapshot", () => {
    const snapshot = parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        flags: {
          "checkout.enabled": {
            type: "boolean",
            defaultVariant: "on",
            variants: {
              on: true
            }
          }
        }
      })
    );

    expect(snapshot.flags["checkout.enabled"]?.variants.on).toBe(true);
  });

  it("throws PARSE_ERROR for invalid JSON", () => {
    try {
      parseJsonFlagSnapshot("{");
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseJsonFlagSnapshot to throw.");
  });

  it("throws SCHEMA_ERROR for invalid schema", () => {
    try {
      parseJsonFlagSnapshot(JSON.stringify({ schemaVersion: 1, flags: [] }));
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR);
      }
      return;
    }

    throw new Error("Expected parseJsonFlagSnapshot to throw.");
  });

  it("rejects variants that do not match the declared type", () => {
    try {
      parseJsonFlagSnapshot(
        JSON.stringify({
          schemaVersion: 1,
          flags: {
            "checkout.enabled": {
              type: "boolean",
              defaultVariant: "on",
              variants: {
                on: "true"
              }
            }
          }
        })
      );
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR);
      }
      return;
    }

    throw new Error("Expected parseJsonFlagSnapshot to throw.");
  });
});
