import { sha256 } from "@noble/hashes/sha2.js";
import { evaluateWithTrace } from "./evaluator/evaluate-engine.js";
import type { EvaluationRequest, EvaluationResult, FlagSnapshot, FlagValue } from "./core-types.js";
export { LocalProviderError, isLocalProviderError } from "./errors/local-provider-error.js";
export { LOCAL_PROVIDER_ERROR_CODES, type LocalProviderErrorCode } from "./errors/error-codes.js";
export {
  EVALUATION_REASONS,
  EVALUATION_SOURCES,
  type EvaluationReason,
  type EvaluationSource
} from "./reasons.js";
export { parseJsonFlagSnapshot } from "./flags/parse-json-snapshot.js";
export type {
  FlagType,
  JsonValue,
  JsonObject,
  FlagValue,
  PercentageRolloutRule,
  FlagDefinition,
  ConditionScalar,
  ScheduledRollout,
  ScheduleEvaluation,
  TargetingCondition,
  TargetingRule,
  FlagSnapshot,
  EvaluationRequest,
  EvaluationContext,
  EvaluationResult,
  EnvOverrideState
} from "./core-types.js";

const encoder = new TextEncoder();
function computeBucket(flagKey: string, targetingKey: string, seed = "v1"): number {
  const digest = sha256(encoder.encode(`${seed}\n${flagKey}\n${targetingKey}`));
  return Number(
    new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getBigUint64(0) % 100000n
  );
}
export function evaluateFlag<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationResult<T> {
  return evaluateWithTrace(snapshot, request, undefined, computeBucket);
}
