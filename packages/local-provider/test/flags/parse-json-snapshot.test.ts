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

  it("parses valid rollout rules", () => {
    const snapshot = parseJsonFlagSnapshot(
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

    expect(snapshot.flags["checkout.rollout"]?.rollout?.[0]).toEqual({
      variant: "on",
      percentage: 50,
      seed: "checkout-rollout-v1"
    });
  });

  it("rejects rollout rules with unknown variants", () => {
    try {
      parseJsonFlagSnapshot(
        JSON.stringify({
          schemaVersion: 1,
          flags: {
            "checkout.rollout": {
              type: "boolean",
              defaultVariant: "off",
              variants: {
                off: false
              },
              rollout: [
                {
                  variant: "on",
                  percentage: 50
                }
              ]
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

  it.each([
    ["snapshot", { schemaVersion: 1, flags: {}, typo: true }, "Flag snapshot"],
    [
      "flag definition",
      {
        schemaVersion: 1,
        flags: {
          "checkout.enabled": {
            type: "boolean",
            defaultVariant: "on",
            variants: { on: true },
            rolluot: []
          }
        }
      },
      'Flag "checkout.enabled"'
    ],
    [
      "rollout rule",
      {
        schemaVersion: 1,
        flags: {
          "checkout.enabled": {
            type: "boolean",
            defaultVariant: "off",
            variants: { on: true, off: false },
            rollout: [{ variant: "on", percentage: 50, typo: true }]
          }
        }
      },
      'Flag "checkout.enabled" rollout rule 0'
    ]
  ] as const)("rejects unknown fields in %s", (_label, input, errorPrefix) => {
    expect(() => parseJsonFlagSnapshot(JSON.stringify(input))).toThrow(
      `${errorPrefix} contains unknown field(s):`
    );
  });

  it("keeps dynamic variant and metadata keys open", () => {
    const snapshot = parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        flags: {
          "checkout.enabled": {
            type: "boolean",
            defaultVariant: "custom-variant",
            variants: { "custom-variant": true },
            metadata: { "custom.flag.attribute": "kept" }
          }
        },
        metadata: { "custom.snapshot.attribute": "kept" }
      })
    );

    expect(snapshot.flags["checkout.enabled"]?.metadata).toEqual({
      "custom.flag.attribute": "kept"
    });
    expect(snapshot.metadata).toEqual({ "custom.snapshot.attribute": "kept" });
  });

  it("does not treat inherited variant names as valid defaults", () => {
    try {
      parseJsonFlagSnapshot(
        JSON.stringify({
          schemaVersion: 1,
          flags: {
            "checkout.enabled": {
              type: "boolean",
              defaultVariant: "toString",
              variants: {
                off: false
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

  it("keeps prototype-like flag and variant keys as own data", () => {
    const snapshot = parseJsonFlagSnapshot(
      `{
        "schemaVersion": 1,
        "flags": {
          "__proto__": {
            "type": "boolean",
            "defaultVariant": "__proto__",
            "variants": {
              "__proto__": true
            }
          }
        }
      }`
    );

    expect(Object.hasOwn(snapshot.flags, "__proto__")).toBe(true);
    const protoFlag = Reflect.get(snapshot.flags, "__proto__");
    expect(Object.hasOwn(protoFlag?.variants ?? {}, "__proto__")).toBe(true);
    expect(Reflect.get(protoFlag?.variants ?? {}, "__proto__")).toBe(true);
  });
});
