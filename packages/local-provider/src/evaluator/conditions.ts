import { SemVer } from "semver";
import type { EvaluationRequest, FlagValue, TargetingCondition } from "../public-types.js";

export function strictSemver(value: unknown): SemVer | undefined {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
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

export function matchesCondition(
  condition: TargetingCondition,
  request: EvaluationRequest<FlagValue>
): boolean {
  if ("all" in condition) return condition.all.every((child) => matchesCondition(child, request));
  if ("any" in condition) return condition.any.some((child) => matchesCondition(child, request));
  const actual = readAttribute(condition.attribute, request);
  if (typeof actual === "string" && actual.length > 4096) return false;
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "in":
      return condition.value.some((candidate) => candidate === actual);
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
      const left = strictSemver(actual);
      const right = strictSemver(condition.value);
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
