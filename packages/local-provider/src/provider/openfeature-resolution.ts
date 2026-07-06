import { ErrorCode, type ResolutionDetails } from "@openfeature/server-sdk";
import type { EvaluationResult, FlagValue } from "../public-types.js";
import { EVALUATION_REASONS } from "../reasons.js";

export function toOpenFeatureResolution<T extends FlagValue>(
  result: EvaluationResult<T>
): ResolutionDetails<T> {
  const errorCode = toOpenFeatureErrorCode(result);

  return {
    value: result.value,
    reason: result.reason,
    flagMetadata: result.flagMetadata,
    ...(result.variant !== undefined ? { variant: result.variant } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {})
  };
}

function toOpenFeatureErrorCode(result: EvaluationResult<FlagValue>): ErrorCode | undefined {
  if (result.reason !== EVALUATION_REASONS.ERROR && result.errorCode !== "FLAG_NOT_FOUND") {
    return undefined;
  }

  switch (result.errorCode) {
    case "FLAG_NOT_FOUND":
      return ErrorCode.FLAG_NOT_FOUND;
    case "PARSE_ERROR":
    case "SCHEMA_ERROR":
    case "OVERRIDE_PARSE_ERROR":
      return ErrorCode.PARSE_ERROR;
    case "TYPE_MISMATCH":
      return ErrorCode.TYPE_MISMATCH;
    case "INVALID_CONTEXT":
      return ErrorCode.INVALID_CONTEXT;
    case "PROVIDER_NOT_READY":
      return ErrorCode.PROVIDER_NOT_READY;
    case "AUDIT_SINK_ERROR":
      return ErrorCode.GENERAL;
    case undefined:
      return undefined;
  }

  return undefined;
}
