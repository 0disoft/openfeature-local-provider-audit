import type {
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagValue
} from "../public-types.js";
import { computeBucket } from "./bucketing.js";
import { evaluateWithTrace as evaluateEngine } from "./evaluate-engine.js";
export function evaluateFlag<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationResult<T> {
  return evaluateWithTrace(snapshot, request);
}

export function evaluateWithTrace<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>,
  trace?: (id: string, matched: boolean) => void
): EvaluationResult<T> {
  return evaluateEngine(snapshot, request, trace, computeBucket);
}
