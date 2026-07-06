import type { ReplayFixture } from "../../src/public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { staticSnapshot } from "../fixtures.js";

export const replayFixtures: readonly ReplayFixture[] = [
  {
    schemaVersion: 1,
    name: "rollout-user-alpha-on",
    snapshot: staticSnapshot,
    request: {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean",
      targetingKey: "user-alpha"
    },
    expected: {
      value: true,
      variant: "on",
      bucket: 29_586,
      reason: EVALUATION_REASONS.SPLIT,
      source: EVALUATION_SOURCES.FILE
    }
  },
  {
    schemaVersion: 1,
    name: "rollout-user-beta-static-fallback",
    snapshot: staticSnapshot,
    request: {
      flagKey: "checkout.rollout",
      defaultValue: true,
      expectedType: "boolean",
      targetingKey: "user-beta"
    },
    expected: {
      value: false,
      variant: "off",
      reason: EVALUATION_REASONS.STATIC,
      source: EVALUATION_SOURCES.FILE
    }
  },
  {
    schemaVersion: 1,
    name: "rollout-missing-targeting-key",
    snapshot: staticSnapshot,
    request: {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean"
    },
    expected: {
      value: false,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT
    }
  },
  {
    schemaVersion: 1,
    name: "env-override-before-rollout",
    snapshot: staticSnapshot,
    overrides: {
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ROLLOUT: "false"
      }
    },
    request: {
      flagKey: "checkout.rollout",
      defaultValue: true,
      expectedType: "boolean",
      targetingKey: "user-alpha"
    },
    expected: {
      value: false,
      reason: EVALUATION_REASONS.ENV_OVERRIDE,
      source: EVALUATION_SOURCES.ENV
    }
  }
];
