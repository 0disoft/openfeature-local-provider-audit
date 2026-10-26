import { SemVer } from "semver";
import type {
  ConditionScalar,
  EvaluationRequest,
  FlagValue,
  TargetingCondition
} from "../core-types.js";

const MAX_SEMVER_LENGTH = 256;
const semverOperands = new WeakMap<
  TargetingCondition,
  { readonly value: string; readonly parsed: SemVer | undefined }
>();

// Keep one operand per live condition. Check its current value even for mutable caller inputs.
function operandSemver(condition: TargetingCondition, value: string): SemVer | undefined {
  const cached = semverOperands.get(condition);
  if (cached !== undefined && cached.value === value) return cached.parsed;
  const parsed = strictSemver(value);
  semverOperands.set(condition, { value, parsed });
  return parsed;
}

const MIN_INDEXED_MEMBERSHIP_SIZE = 16;
const membershipIndexes = new WeakMap<readonly ConditionScalar[], ReadonlySet<ConditionScalar>>();

// Only validator-owned, immutable copies are indexed; caller arrays never acquire stale caches.
export function captureConditionValues(
  values: readonly ConditionScalar[]
): readonly ConditionScalar[] {
  const captured = Object.freeze([...values]);
  if (captured.length >= MIN_INDEXED_MEMBERSHIP_SIZE)
    membershipIndexes.set(captured, new Set(captured));
  return captured;
}

export function strictSemver(value: unknown): SemVer | undefined {
  if (
    typeof value !== "string" ||
    value.length > MAX_SEMVER_LENGTH ||
    !/^[0-9]/.test(value) ||
    value.trim() !== value
  )
    return undefined;
  try {
    return new SemVer(value);
  } catch {
    return undefined;
  }
}

// Owned by one synchronous evaluation, never retained by context or condition identity.
export interface ConditionEvaluation {
  value: string | undefined;
  parsed: SemVer | undefined;
  previousValue: string | undefined;
  previousParsed: SemVer | undefined;
}

// A two-entry MRU slot avoids alternating-attribute churn without an accumulating cache.
function actualSemver(value: string, evaluation: ConditionEvaluation): SemVer | undefined {
  if (evaluation.value === value) return evaluation.parsed;
  const parsed =
    evaluation.previousValue === value ? evaluation.previousParsed : strictSemver(value);
  evaluation.previousValue = evaluation.value;
  evaluation.previousParsed = evaluation.parsed;
  evaluation.value = value;
  evaluation.parsed = parsed;
  return parsed;
}

function hasOwnGroup<K extends "all" | "any">(
  condition: TargetingCondition,
  key: K
): condition is Extract<TargetingCondition, Record<K, readonly TargetingCondition[]>> {
  return Object.hasOwn(condition, key);
}

export function matchesCondition(
  condition: TargetingCondition,
  request: EvaluationRequest<FlagValue>,
  evaluation: ConditionEvaluation = {
    value: undefined,
    parsed: undefined,
    previousValue: undefined,
    previousParsed: undefined
  }
): boolean {
  if (hasOwnGroup(condition, "all"))
    return condition.all.every((child) => matchesCondition(child, request, evaluation));
  if (hasOwnGroup(condition, "any"))
    return condition.any.some((child) => matchesCondition(child, request, evaluation));
  const actual = readAttribute(condition.attribute, request);
  if (typeof actual === "string" && actual.length > 4096) return false;
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "in": {
      const indexed =
        condition.value.length >= MIN_INDEXED_MEMBERSHIP_SIZE
          ? membershipIndexes.get(condition.value)
          : undefined;
      return indexed === undefined
        ? condition.value.some((candidate) => candidate === actual)
        : indexed.has(actual as ConditionScalar);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
      return condition.op === "gt"
        ? actual > condition.value
        : condition.op === "gte"
          ? actual >= condition.value
          : condition.op === "lt"
            ? actual < condition.value
            : actual <= condition.value;
    default: {
      let left: SemVer | undefined;
      if (typeof actual === "string" && actual.length <= MAX_SEMVER_LENGTH) {
        left = actualSemver(actual, evaluation);
      }
      const right = operandSemver(condition, condition.value);
      if (!left || !right) return false;
      const comparison = left.compare(right);
      switch (condition.op) {
        case "semverEq":
          return comparison === 0;
        case "semverGt":
          return comparison > 0;
        case "semverGte":
          return comparison >= 0;
        case "semverLt":
          return comparison < 0;
        case "semverLte":
          return comparison <= 0;
      }
    }
  }
}

function readAttribute(path: readonly string[], request: EvaluationRequest<FlagValue>): unknown {
  if (path.length === 1 && path[0] === "targetingKey" && request.targetingKey !== undefined)
    return request.targetingKey;
  let value: unknown = request.context;
  for (const key of path) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") return undefined;
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return undefined;
    value = descriptor.value;
  }
  return value;
}
