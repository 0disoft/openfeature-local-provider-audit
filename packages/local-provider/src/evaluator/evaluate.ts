import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import type {
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagValue
} from "../public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import { flagValueMatchesType } from "./type-guards.js";

export function evaluateFlag<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationResult<T> {
  const flag = snapshot.flags[request.flagKey];

  if (flag === undefined) {
    return {
      flagKey: request.flagKey,
      value: request.defaultValue,
      reason: EVALUATION_REASONS.DEFAULT,
      source: EVALUATION_SOURCES.DEFAULT,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.FLAG_NOT_FOUND,
      errorMessage: `Flag "${request.flagKey}" was not found.`,
      flagMetadata: {}
    };
  }

  if (flag.type !== request.expectedType) {
    return {
      flagKey: request.flagKey,
      value: request.defaultValue,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH,
      errorMessage: `Flag "${request.flagKey}" is type "${flag.type}", not "${request.expectedType}".`,
      flagMetadata: flag.metadata ?? {}
    };
  }

  const overrideError = getOverrideError(request);
  if (overrideError !== undefined) {
    return {
      flagKey: request.flagKey,
      value: request.defaultValue,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.OVERRIDE_PARSE_ERROR,
      errorMessage: overrideError,
      flagMetadata: flag.metadata ?? {}
    };
  }

  const overrideValue = request.overrides?.values[request.flagKey];
  if (overrideValue !== undefined) {
    if (!flagValueMatchesType(overrideValue, request.expectedType)) {
      return {
        flagKey: request.flagKey,
        value: request.defaultValue,
        reason: EVALUATION_REASONS.ERROR,
        source: EVALUATION_SOURCES.ERROR,
        errorCode: LOCAL_PROVIDER_ERROR_CODES.OVERRIDE_PARSE_ERROR,
        errorMessage: `Override for flag "${request.flagKey}" does not match type "${request.expectedType}".`,
        flagMetadata: flag.metadata ?? {}
      };
    }

    return {
      flagKey: request.flagKey,
      value: overrideValue as T,
      reason: EVALUATION_REASONS.ENV_OVERRIDE,
      source: EVALUATION_SOURCES.ENV,
      flagMetadata: flag.metadata ?? {}
    };
  }

  const value = flag.variants[flag.defaultVariant];

  if (value === undefined || !flagValueMatchesType(value, request.expectedType)) {
    return {
      flagKey: request.flagKey,
      value: request.defaultValue,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH,
      errorMessage: `Flag "${request.flagKey}" default variant does not match its declared type.`,
      flagMetadata: flag.metadata ?? {}
    };
  }

  return {
    flagKey: request.flagKey,
    value: value as T,
    variant: flag.defaultVariant,
    reason: EVALUATION_REASONS.STATIC,
    source: EVALUATION_SOURCES.FILE,
    flagMetadata: flag.metadata ?? {}
  };
}

function getOverrideError(request: EvaluationRequest<FlagValue>): string | undefined {
  if (request.overrides?.globalError !== undefined) {
    return request.overrides.globalError;
  }

  return request.overrides?.errors[request.flagKey];
}
