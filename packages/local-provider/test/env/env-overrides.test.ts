import { describe, expect, it } from "vitest";
import { createEnvOverrides } from "../../src/env/env-overrides.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { staticSnapshot } from "../fixtures.js";

describe("env overrides", () => {
  it("uses explicit JSON overrides before per-flag envVar values", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      overridesJson: JSON.stringify({ "checkout.enabled": true }),
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean",
        overrides
      })
    ).toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.ENV_OVERRIDE,
      source: EVALUATION_SOURCES.ENV
    });
  });

  it("uses explicit per-flag envVar values when JSON override is absent", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: true,
        expectedType: "boolean",
        overrides
      })
    ).toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ENV_OVERRIDE,
      source: EVALUATION_SOURCES.ENV
    });
  });

  it("parses string, number, and object per-flag envVar values", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_COPY: "Leave cart",
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_LIMIT: "9",
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_CONFIG: JSON.stringify({
          retries: 4,
          mode: "override"
        })
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.copy",
        defaultValue: "fallback",
        expectedType: "string",
        overrides
      }).value
    ).toBe("Leave cart");

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.limit",
        defaultValue: 1,
        expectedType: "number",
        overrides
      }).value
    ).toBe(9);

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.config",
        defaultValue: { retries: 0 },
        expectedType: "object",
        overrides
      }).value
    ).toEqual({
      retries: 4,
      mode: "override"
    });
  });

  it("does not auto-map flag keys to env variables", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      env: {
        CHECKOUT_ENABLED: "false"
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean",
        overrides
      })
    ).toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      source: EVALUATION_SOURCES.FILE
    });
  });

  it("returns an error result for invalid JSON override input", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      overridesJson: "{",
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean",
        overrides
      })
    ).toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.OVERRIDE_PARSE_ERROR
    });
  });

  it("returns an error result when a JSON override value mismatches the flag type", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      overridesJson: JSON.stringify({ "checkout.enabled": "false" })
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: true,
        expectedType: "boolean",
        overrides
      })
    ).toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.OVERRIDE_PARSE_ERROR
    });
  });

  it("returns an error result for invalid per-flag envVar input", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "yes"
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean",
        overrides
      })
    ).toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.OVERRIDE_PARSE_ERROR
    });
  });
});
