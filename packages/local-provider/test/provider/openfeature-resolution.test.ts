import { ErrorCode } from "@openfeature/server-sdk";
import { describe, expect, it } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { toOpenFeatureResolution } from "../../src/provider/openfeature-resolution.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import type { EvaluationResult } from "../../src/public-types.js";

const baseResult: EvaluationResult<boolean> = {
  flagKey: "checkout.enabled",
  value: false,
  reason: EVALUATION_REASONS.ERROR,
  source: EVALUATION_SOURCES.ERROR,
  flagMetadata: {}
};

describe("toOpenFeatureResolution", () => {
  it.each([
    [LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR, ErrorCode.PARSE_ERROR],
    [LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR, ErrorCode.PARSE_ERROR],
    [LOCAL_PROVIDER_ERROR_CODES.OVERRIDE_PARSE_ERROR, ErrorCode.PARSE_ERROR],
    [LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH, ErrorCode.TYPE_MISMATCH],
    [LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT, ErrorCode.INVALID_CONTEXT],
    [LOCAL_PROVIDER_ERROR_CODES.PROVIDER_NOT_READY, ErrorCode.PROVIDER_NOT_READY],
    [LOCAL_PROVIDER_ERROR_CODES.AUDIT_SINK_ERROR, ErrorCode.GENERAL]
  ] as const)("maps %s to the OpenFeature error code", (localCode, openFeatureCode) => {
    expect(
      toOpenFeatureResolution({
        ...baseResult,
        errorCode: localCode,
        errorMessage: "synthetic failure"
      })
    ).toEqual({
      value: false,
      reason: EVALUATION_REASONS.ERROR,
      flagMetadata: {},
      errorCode: openFeatureCode,
      errorMessage: "synthetic failure"
    });
  });

  it("maps a missing flag even though its local reason is DEFAULT", () => {
    expect(
      toOpenFeatureResolution({
        ...baseResult,
        reason: EVALUATION_REASONS.DEFAULT,
        source: EVALUATION_SOURCES.DEFAULT,
        errorCode: LOCAL_PROVIDER_ERROR_CODES.FLAG_NOT_FOUND
      })
    ).toMatchObject({
      reason: EVALUATION_REASONS.DEFAULT,
      errorCode: ErrorCode.FLAG_NOT_FOUND
    });
  });

  it("omits optional OpenFeature fields when evaluation does not provide them", () => {
    expect(
      toOpenFeatureResolution({
        ...baseResult,
        value: true,
        reason: EVALUATION_REASONS.STATIC,
        source: EVALUATION_SOURCES.FILE
      })
    ).toEqual({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      flagMetadata: {}
    });
  });
});
