import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import type {
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagDefinition,
  FlagValue
} from "../core-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import { selectRolloutVariant, type ComputeBucket } from "./bucketing-rules.js";
import { matchesCondition, type ConditionEvaluation } from "./conditions.js";
import { flagValueMatchesType } from "./type-guards.js";
import { selectScheduledVariant, validScheduleTime } from "./schedule.js";

export function evaluateWithTrace<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>,
  trace: ((id: string, matched: boolean) => void) | undefined,
  computeBucket: ComputeBucket
): EvaluationResult<T> {
  const flag = getOwn(snapshot.flags, request.flagKey);

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

  if (snapshot.schemaVersion === 2 && flag.disabledVariant !== undefined) {
    return selectedVariant(flag, request, flag.disabledVariant, EVALUATION_REASONS.DISABLED);
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

  const overrideValue = getOwn(request.overrides?.values, request.flagKey);
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

  if (snapshot.schemaVersion === 2) {
    let conditionEvaluation: ConditionEvaluation | undefined;
    for (const rule of flag.rules ?? []) {
      conditionEvaluation ??= { value: undefined, parsed: undefined };
      const matched = matchesCondition(rule.when, request, conditionEvaluation);
      trace?.(rule.id, matched);
      if (!matched) continue;
      if (rule.variant !== undefined) {
        return {
          ...selectedVariant(flag, request, rule.variant, EVALUATION_REASONS.TARGETING_MATCH),
          ruleId: rule.id
        };
      }
      if (request.targetingKey === undefined || !request.targetingKey.trim()) {
        return {
          flagKey: request.flagKey,
          value: request.defaultValue,
          reason: EVALUATION_REASONS.ERROR,
          source: EVALUATION_SOURCES.ERROR,
          errorCode: LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT,
          errorMessage: "Matched targeting rollout requires a non-empty targetingKey.",
          ruleId: rule.id,
          flagMetadata: flag.metadata ?? {}
        };
      }
      const selection = selectRolloutVariant(
        request.flagKey,
        request.targetingKey,
        rule.rollout,
        computeBucket
      );
      return {
        ...selectedVariant(
          flag,
          request,
          selection.variant ?? flag.defaultVariant,
          selection.variant === undefined
            ? EVALUATION_REASONS.TARGETING_MATCH
            : EVALUATION_REASONS.SPLIT
        ),
        ruleId: rule.id,
        bucket: selection.bucket
      };
    }
  }

  if (snapshot.schemaVersion === 2 && flag.schedule !== undefined) {
    if (
      !validScheduleTime(request.evaluationTime) ||
      request.targetingKey === undefined ||
      !request.targetingKey.trim()
    )
      return {
        flagKey: request.flagKey,
        value: request.defaultValue,
        reason: EVALUATION_REASONS.ERROR,
        source: EVALUATION_SOURCES.ERROR,
        errorCode: LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT,
        errorMessage: "Scheduled rollout requires valid evaluationTime and targetingKey.",
        flagMetadata: flag.metadata ?? {}
      };
    const selection = selectScheduledVariant(
      flag.schedule,
      request.flagKey,
      request.targetingKey,
      request.evaluationTime,
      computeBucket
    );
    return {
      ...selectedVariant(
        flag,
        request,
        selection.variant ?? flag.defaultVariant,
        selection.variant === undefined ? EVALUATION_REASONS.STATIC : EVALUATION_REASONS.SPLIT
      ),
      bucket: selection.bucket,
      schedule: selection.schedule
    };
  }

  if (flag.rollout !== undefined) {
    if (request.targetingKey === undefined || !request.targetingKey.trim()) {
      return {
        flagKey: request.flagKey,
        value: request.defaultValue,
        reason: EVALUATION_REASONS.ERROR,
        source: EVALUATION_SOURCES.ERROR,
        errorCode: LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT,
        errorMessage: `Flag "${request.flagKey}" requires a non-empty targetingKey for rollout evaluation.`,
        flagMetadata: flag.metadata ?? {}
      };
    }

    const selection = selectRolloutVariant(
      request.flagKey,
      request.targetingKey,
      flag.rollout,
      computeBucket
    );
    if (selection.variant !== undefined) {
      const rolloutValue = getOwn(flag.variants, selection.variant);
      if (rolloutValue === undefined || !flagValueMatchesType(rolloutValue, request.expectedType)) {
        return {
          flagKey: request.flagKey,
          value: request.defaultValue,
          reason: EVALUATION_REASONS.ERROR,
          source: EVALUATION_SOURCES.ERROR,
          errorCode: LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH,
          errorMessage: `Flag "${request.flagKey}" rollout variant does not match its declared type.`,
          bucket: selection.bucket,
          flagMetadata: flag.metadata ?? {}
        };
      }

      return {
        flagKey: request.flagKey,
        value: rolloutValue as T,
        variant: selection.variant,
        reason: EVALUATION_REASONS.SPLIT,
        source: EVALUATION_SOURCES.FILE,
        bucket: selection.bucket,
        flagMetadata: flag.metadata ?? {}
      };
    }
  }

  const value = getOwn(flag.variants, flag.defaultVariant);

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

function selectedVariant<T extends FlagValue>(
  flag: FlagDefinition,
  request: EvaluationRequest<T>,
  variant: string,
  reason: EvaluationResult<T>["reason"]
): EvaluationResult<T> {
  const value = getOwn(flag.variants, variant);
  if (value === undefined || !flagValueMatchesType(value, request.expectedType)) {
    return {
      flagKey: request.flagKey,
      value: request.defaultValue,
      reason: EVALUATION_REASONS.ERROR,
      source: EVALUATION_SOURCES.ERROR,
      errorCode: LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH,
      errorMessage: "Selected variant does not match its declared type.",
      flagMetadata: flag.metadata ?? {}
    };
  }
  return {
    flagKey: request.flagKey,
    value: value as T,
    variant,
    reason,
    source: EVALUATION_SOURCES.FILE,
    flagMetadata: flag.metadata ?? {}
  };
}

function getOverrideError(request: EvaluationRequest<FlagValue>): string | undefined {
  if (request.overrides?.globalError !== undefined) {
    return request.overrides.globalError;
  }

  return getOwn(request.overrides?.errors, request.flagKey);
}

function getOwn<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}
