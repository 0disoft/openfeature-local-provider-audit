import { evaluateFlag, type EvaluationRequest, type FlagSnapshot } from "../../src/index.js";

declare const snapshot: FlagSnapshot;

const booleanRequest: EvaluationRequest<boolean> = {
  flagKey: "checkout.enabled",
  defaultValue: false,
  expectedType: "boolean"
};

evaluateFlag(snapshot, booleanRequest).value satisfies boolean;

const nullableObjectRequest: EvaluationRequest<null> = {
  flagKey: "checkout.options",
  defaultValue: null,
  expectedType: "object"
};

evaluateFlag(snapshot, nullableObjectRequest).value satisfies null;

// @ts-expect-error A boolean default cannot claim string evaluation.
const mismatchedRequest: EvaluationRequest<boolean> = {
  flagKey: "checkout.enabled",
  defaultValue: false,
  expectedType: "string"
};

void mismatchedRequest;

// @ts-expect-error Direct calls must also correlate defaultValue and expectedType.
evaluateFlag(snapshot, {
  flagKey: "checkout.enabled",
  defaultValue: false,
  expectedType: "string"
});
