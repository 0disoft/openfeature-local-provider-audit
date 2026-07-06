import { describe, expect, it } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { staticSnapshot } from "../fixtures.js";

describe("evaluateFlag", () => {
  it("resolves a static boolean flag", () => {
    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean"
      })
    ).toEqual({
      flagKey: "checkout.enabled",
      value: true,
      variant: "on",
      reason: EVALUATION_REASONS.STATIC,
      source: EVALUATION_SOURCES.FILE,
      flagMetadata: {
        owner: "checkout"
      }
    });
  });

  it("resolves static string, number, and object flags", () => {
    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.copy",
        defaultValue: "fallback",
        expectedType: "string"
      }).value
    ).toBe("Buy now");

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.limit",
        defaultValue: 1,
        expectedType: "number"
      }).value
    ).toBe(5);

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.config",
        defaultValue: { retries: 0 },
        expectedType: "object"
      }).value
    ).toEqual({ retries: 2, mode: "safe" });
  });

  it("returns the caller default for a missing flag", () => {
    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.unknown",
        defaultValue: false,
        expectedType: "boolean"
      })
    ).toMatchObject({
      flagKey: "checkout.unknown",
      value: false,
      reason: EVALUATION_REASONS.DEFAULT,
      source: EVALUATION_SOURCES.DEFAULT,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.FLAG_NOT_FOUND
    });
  });

  it("returns the caller default with an error for type mismatch", () => {
    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: "fallback",
        expectedType: "string"
      })
    ).toMatchObject({
      flagKey: "checkout.enabled",
      value: "fallback",
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH
    });
  });
});
