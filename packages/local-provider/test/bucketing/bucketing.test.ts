import { describe, expect, it } from "vitest";
import { createEnvOverrides } from "../../src/env/env-overrides.js";
import { computeBucket } from "../../src/evaluator/bucketing.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import type { FlagSnapshot } from "../../src/public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { staticSnapshot } from "../fixtures.js";

describe("bucketing", () => {
  it("computes stable SHA-256 buckets for replay fixtures", () => {
    expect(computeBucket("checkout.rollout", "user-alpha", "checkout-rollout-v1")).toBe(29_586);
    expect(computeBucket("checkout.rollout", "user-beta", "checkout-rollout-v1")).toBe(51_164);
  });

  it("uses deterministic percentage rollout when targetingKey is provided", () => {
    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.rollout",
        defaultValue: false,
        expectedType: "boolean",
        targetingKey: "user-alpha"
      })
    ).toMatchObject({
      value: true,
      variant: "on",
      bucket: 29_586,
      reason: EVALUATION_REASONS.SPLIT,
      source: EVALUATION_SOURCES.FILE
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.rollout",
        defaultValue: true,
        expectedType: "boolean",
        targetingKey: "user-beta"
      })
    ).toMatchObject({
      value: false,
      variant: "off",
      reason: EVALUATION_REASONS.STATIC,
      source: EVALUATION_SOURCES.FILE
    });
  });

  it("treats percentage boundaries as bucket upper bounds", () => {
    const rolloutFlag = staticSnapshot.flags["checkout.rollout"];
    if (rolloutFlag === undefined) {
      throw new Error("Expected checkout.rollout fixture to exist.");
    }

    const snapshot: FlagSnapshot = {
      ...staticSnapshot,
      flags: {
        ...staticSnapshot.flags,
        "checkout.rollout": {
          ...rolloutFlag,
          rollout: [
            {
              variant: "on",
              percentage: 29.586,
              seed: "checkout-rollout-v1"
            }
          ]
        }
      }
    };

    expect(
      evaluateFlag(snapshot, {
        flagKey: "checkout.rollout",
        defaultValue: true,
        expectedType: "boolean",
        targetingKey: "user-alpha"
      })
    ).toMatchObject({
      value: false,
      variant: "off",
      reason: EVALUATION_REASONS.STATIC
    });
  });

  it("returns an invalid context error when rollout targetingKey is missing", () => {
    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.rollout",
        defaultValue: false,
        expectedType: "boolean"
      })
    ).toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT
    });
  });

  it("uses env overrides before rollout evaluation", () => {
    const overrides = createEnvOverrides(staticSnapshot, {
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ROLLOUT: "false"
      }
    });

    expect(
      evaluateFlag(staticSnapshot, {
        flagKey: "checkout.rollout",
        defaultValue: true,
        expectedType: "boolean",
        targetingKey: "user-alpha",
        overrides
      })
    ).toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ENV_OVERRIDE,
      source: EVALUATION_SOURCES.ENV
    });
  });
});
