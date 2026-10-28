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
interface MembershipIndex {
  readonly values: ReadonlySet<ConditionScalar>;
  readonly types: ReadonlySet<string>;
}
const membershipIndexes = new WeakMap<readonly ConditionScalar[], MembershipIndex>();

// Only validator-owned, immutable copies are indexed; caller arrays never acquire stale caches.
export function captureConditionValues(
  values: readonly ConditionScalar[]
): readonly ConditionScalar[] {
  const captured = Object.freeze([...values]);
  if (captured.length >= MIN_INDEXED_MEMBERSHIP_SIZE)
    membershipIndexes.set(captured, {
      values: new Set(captured),
      types: new Set(captured.map((value) => typeof value))
    });
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

function hasNot(condition: TargetingCondition): condition is { readonly not: TargetingCondition } {
  return Object.hasOwn(condition, "not");
}

type Leaf = Extract<TargetingCondition, { readonly attribute: readonly string[] }>;
const MISSING = Symbol("missing attribute");
const INVALID = Symbol("invalid attribute");

// New predicates distinguish absent own data from denied access or malformed paths.
function readCheckedAttribute(
  path: readonly string[],
  request: EvaluationRequest<FlagValue>
): unknown {
  try {
    if (path.length === 1 && path[0] === "targetingKey") {
      const explicit = Object.getOwnPropertyDescriptor(request, "targetingKey");
      if (explicit && !("value" in explicit)) return INVALID;
      if (!explicit && "targetingKey" in request) return INVALID;
      if (explicit?.value !== undefined)
        return typeof explicit.value === "string" ? explicit.value : INVALID;
    }
    const context = Object.getOwnPropertyDescriptor(request, "context");
    if (context && !("value" in context)) return INVALID;
    if (!context && "context" in request) return INVALID;
    let value: unknown = context?.value;
    for (const key of path) {
      if (["__proto__", "prototype", "constructor"].includes(key)) return INVALID;
      if (value === undefined) return MISSING;
      if (value === null || typeof value !== "object") return INVALID;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return key in value ? INVALID : MISSING;
      if (!("value" in descriptor)) return INVALID;
      value = descriptor.value;
    }
    return value === undefined ? MISSING : value;
  } catch {
    // Proxy traps cannot be made side-effect free, but exceptions never become matches.
    return INVALID;
  }
}

function boundedScalar(value: unknown): value is ConditionScalar {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 4096)
  );
}

function presence(actual: unknown, expected: boolean): boolean | undefined {
  if (actual === MISSING) return !expected;
  if (
    actual === INVALID ||
    !(boundedScalar(actual) || (typeof actual === "object" && actual !== null))
  )
    return undefined;
  return expected;
}

// Invalid dominates the entire subtree under not. Never short-circuit a known
// boolean past an unchecked sibling and then invert it into a match.
function checkedCondition(
  condition: TargetingCondition,
  request: EvaluationRequest<FlagValue>,
  evaluation: ConditionEvaluation
): boolean | undefined {
  if (hasNot(condition)) {
    const result = checkedCondition(condition.not, request, evaluation);
    return result === undefined ? undefined : !result;
  }
  if (hasOwnGroup(condition, "all") || hasOwnGroup(condition, "any")) {
    const all = hasOwnGroup(condition, "all");
    const children = hasOwnGroup(condition, "all") ? condition.all : condition.any;
    let result = all;
    for (const child of children) {
      const matched = checkedCondition(child, request, evaluation);
      if (matched === undefined) return undefined;
      result = all ? result && matched : result || matched;
    }
    return result;
  }
  const actual = readCheckedAttribute(condition.attribute, request);
  if (condition.op === "exists") return presence(actual, condition.value);
  if (!boundedScalar(actual)) return undefined;
  switch (condition.op) {
    case "eq":
      if (typeof actual !== typeof condition.value) return undefined;
      break;
    case "in": {
      const indexed =
        condition.value.length >= MIN_INDEXED_MEMBERSHIP_SIZE
          ? membershipIndexes.get(condition.value)
          : undefined;
      if (indexed !== undefined)
        return indexed.types.has(typeof actual) ? indexed.values.has(actual) : undefined;
      if (!condition.value.some((candidate) => typeof candidate === typeof actual))
        return undefined;
      break;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      if (typeof actual !== "number") return undefined;
      break;
    case "startsWith":
    case "endsWith":
      if (typeof actual !== "string") return undefined;
      break;
    default:
      if (
        typeof actual !== "string" ||
        !actualSemver(actual, evaluation) ||
        !operandSemver(condition, condition.value)
      )
        return undefined;
  }
  return matchesLeaf(condition, actual, evaluation);
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
  if (hasNot(condition)) {
    const result = checkedCondition(condition.not, request, evaluation);
    return result === undefined ? false : !result;
  }
  if (hasOwnGroup(condition, "all"))
    return condition.all.every((child) => matchesCondition(child, request, evaluation));
  if (hasOwnGroup(condition, "any"))
    return condition.any.some((child) => matchesCondition(child, request, evaluation));
  if (condition.op === "exists")
    return presence(readCheckedAttribute(condition.attribute, request), condition.value) === true;
  const actual = readAttribute(condition.attribute, request);
  return matchesLeaf(condition, actual, evaluation);
}

function matchesLeaf(
  condition: Exclude<Leaf, { readonly op: "exists" }>,
  actual: unknown,
  evaluation: ConditionEvaluation
): boolean {
  if (typeof actual === "string" && actual.length > 4096) return false;
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "startsWith":
    case "endsWith":
      return (
        typeof actual === "string" &&
        (condition.op === "startsWith"
          ? actual.startsWith(condition.value)
          : actual.endsWith(condition.value))
      );
    case "in": {
      const indexed =
        condition.value.length >= MIN_INDEXED_MEMBERSHIP_SIZE
          ? membershipIndexes.get(condition.value)
          : undefined;
      return indexed === undefined
        ? condition.value.some((candidate) => candidate === actual)
        : indexed.values.has(actual as ConditionScalar);
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
