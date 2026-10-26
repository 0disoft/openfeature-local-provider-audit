import { getOwn } from "./own-property.js";
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
      flagMetadata: getOwn(flag, "metadata") ?? {}
    };
  }

  const disabledVariant =
    snapshot.schemaVersion === 2 ? getOwn(flag, "disabledVariant") : undefined;
  if (disabledVariant !== undefined) {
    return selectedVariant(flag, request, disabledVariant, EVALUATION_REASONS.DISABLED);
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
      flagMetadata: getOwn(flag, "metadata") ?? {}
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
        flagMetadata: getOwn(flag, "metadata") ?? {}
      };
    }

    return {
      flagKey: request.flagKey,
      value: overrideValue as T,
      reason: EVALUATION_REASONS.ENV_OVERRIDE,
      source: EVALUATION_SOURCES.ENV,
      flagMetadata: getOwn(flag, "metadata") ?? {}
    };
  }

  if (snapshot.schemaVersion === 2) {
    let conditionEvaluation: ConditionEvaluation | undefined;
    for (const rule of getOwn(flag, "rules") ?? []) {
      conditionEvaluation ??= {
        value: undefined,
        parsed: undefined,
        previousValue: undefined,
        previousParsed: undefined
      };
      const matched = matchesCondition(rule.when, request, conditionEvaluation);
      trace?.(rule.id, matched);
      if (!matched) continue;
      const variant = getOwn(rule, "variant");
      if (variant !== undefined) {
        return {
          ...selectedVariant(flag, request, variant, EVALUATION_REASONS.TARGETING_MATCH),
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
          flagMetadata: getOwn(flag, "metadata") ?? {}
        };
      }
      const rollout = getOwn(rule, "rollout");
      if (rollout === undefined) throw new TypeError("Targeting rollout must be an own property.");
      const selection = selectRolloutVariant(
        request.flagKey,
        request.targetingKey,
        rollout,
        computeBucket
      );
      const selectionVariant = getOwn(selection, "variant");
      return {
        ...selectedVariant(
          flag,
          request,
          selectionVariant ?? flag.defaultVariant,
          selectionVariant === undefined
            ? EVALUATION_REASONS.TARGETING_MATCH
            : EVALUATION_REASONS.SPLIT
        ),
        ruleId: rule.id,
        bucket: selection.bucket
      };
    }
  }

  const schedule = snapshot.schemaVersion === 2 ? getOwn(flag, "schedule") : undefined;
  if (schedule !== undefined) {
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
        flagMetadata: getOwn(flag, "metadata") ?? {}
      };
    const selection = selectScheduledVariant(
      schedule,
      request.flagKey,
      request.targetingKey,
      request.evaluationTime,
      computeBucket
    );
    const selectionVariant = getOwn(selection, "variant");
    return {
      ...selectedVariant(
        flag,
        request,
        selectionVariant ?? flag.defaultVariant,
        selectionVariant === undefined ? EVALUATION_REASONS.STATIC : EVALUATION_REASONS.SPLIT
      ),
      bucket: selection.bucket,
      schedule: selection.schedule
    };
  }

  const rollout = getOwn(flag, "rollout");
  if (rollout !== undefined) {
    if (request.targetingKey === undefined || !request.targetingKey.trim()) {
      return {
        flagKey: request.flagKey,
        value: request.defaultValue,
        reason: EVALUATION_REASONS.ERROR,
        source: EVALUATION_SOURCES.ERROR,
        errorCode: LOCAL_PROVIDER_ERROR_CODES.INVALID_CONTEXT,
        errorMessage: `Flag "${request.flagKey}" requires a non-empty targetingKey for rollout evaluation.`,
        flagMetadata: getOwn(flag, "metadata") ?? {}
      };
    }

    const selection = selectRolloutVariant(
      request.flagKey,
      request.targetingKey,
      rollout,
      computeBucket
    );
    const selectionVariant = getOwn(selection, "variant");
    if (selectionVariant !== undefined) {
      const rolloutValue = getOwn(flag.variants, selectionVariant);
      if (rolloutValue === undefined || !flagValueMatchesType(rolloutValue, request.expectedType)) {
        return {
          flagKey: request.flagKey,
          value: request.defaultValue,
          reason: EVALUATION_REASONS.ERROR,
          source: EVALUATION_SOURCES.ERROR,
          errorCode: LOCAL_PROVIDER_ERROR_CODES.TYPE_MISMATCH,
          errorMessage: `Flag "${request.flagKey}" rollout variant does not match its declared type.`,
          bucket: selection.bucket,
          flagMetadata: getOwn(flag, "metadata") ?? {}
        };
      }

      return {
        flagKey: request.flagKey,
        value: rolloutValue as T,
        variant: selectionVariant,
        reason: EVALUATION_REASONS.SPLIT,
        source: EVALUATION_SOURCES.FILE,
        bucket: selection.bucket,
        flagMetadata: getOwn(flag, "metadata") ?? {}
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
      flagMetadata: getOwn(flag, "metadata") ?? {}
    };
  }

  return {
    flagKey: request.flagKey,
    value: value as T,
    variant: flag.defaultVariant,
    reason: EVALUATION_REASONS.STATIC,
    source: EVALUATION_SOURCES.FILE,
    flagMetadata: getOwn(flag, "metadata") ?? {}
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
      flagMetadata: getOwn(flag, "metadata") ?? {}
    };
  }
  return {
    flagKey: request.flagKey,
    value: value as T,
    variant,
    reason,
    source: EVALUATION_SOURCES.FILE,
    flagMetadata: getOwn(flag, "metadata") ?? {}
  };
}

function getOverrideError(request: EvaluationRequest<FlagValue>): string | undefined {
  const globalError = getOwn(request.overrides, "globalError");
  if (globalError !== undefined) {
    return globalError;
  }

  return getOwn(request.overrides?.errors, request.flagKey);
}
