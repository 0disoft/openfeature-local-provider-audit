import { createOverrideHash, createSnapshotHash } from "../audit/audit-event.js";
import type {
  EvaluationExplanation,
  EvaluationRequest,
  FlagSnapshot,
  FlagValue,
  RuleExplanation
} from "../public-types.js";
import { evaluateWithTrace } from "./evaluate.js";

export function explainEvaluation<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationExplanation {
  const rules: RuleExplanation[] = [];
  const result = evaluateWithTrace(snapshot, request, (ruleId, matched) =>
    rules.push({ ruleId, matched })
  );
  return {
    flagKey: result.flagKey,
    reason: result.reason,
    source: result.source,
    snapshotHash: createSnapshotHash(snapshot),
    rules,
    ...(result.schedule !== undefined ? { schedule: result.schedule } : {}),
    ...(request.overrides !== undefined
      ? { overrideHash: createOverrideHash(request.overrides) }
      : {}),
    ...(result.variant !== undefined ? { variant: result.variant } : {}),
    ...(result.ruleId !== undefined ? { ruleId: result.ruleId } : {}),
    ...(result.bucket !== undefined ? { bucket: result.bucket } : {}),
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {})
  };
}
