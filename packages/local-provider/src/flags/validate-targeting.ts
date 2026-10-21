import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { strictSemver } from "../evaluator/conditions.js";
import type {
  ConditionScalar,
  TargetingCondition,
  TargetingRule,
  PercentageRolloutRule
} from "../public-types.js";

export function validateTargetingRules(
  value: unknown,
  hasVariant: (name: string) => boolean,
  parseRollout: (value: unknown) => readonly PercentageRolloutRule[] | undefined
): readonly TargetingRule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100)
    fail("rules must be an array of at most 100 entries");
  const ids = new Set<string>();
  return value.map((entry): TargetingRule => {
    if (!isRecord(entry)) fail("rule must be an object");
    keys(entry, ["id", "when", "variant", "rollout"]);
    if (!shortString(entry.id) || ids.has(entry.id))
      fail("rule id must be unique and 1..128 characters");
    ids.add(entry.id);
    const when = condition(entry.when, { nodes: 0 }, 1);
    if ((entry.variant !== undefined) === (entry.rollout !== undefined))
      fail("rule requires exactly one of variant or rollout");
    if (entry.variant !== undefined) {
      if (typeof entry.variant !== "string" || !hasVariant(entry.variant))
        fail("rule variant must exist");
      return { id: entry.id, when, variant: entry.variant };
    }
    const rollout = parseRollout(entry.rollout);
    if (!rollout) fail("rule rollout is required");
    return { id: entry.id, when, rollout };
  });
}

function condition(value: unknown, budget: { nodes: number }, depth: number): TargetingCondition {
  if (depth > 8 || ++budget.nodes > 100) fail("condition exceeds 8 levels or 100 nodes");
  if (!isRecord(value)) fail("condition must be an object");
  if (Object.hasOwn(value, "all") || Object.hasOwn(value, "any")) {
    const name = Object.hasOwn(value, "all") ? "all" : "any";
    keys(value, [name]);
    const children = value[name];
    if (!Array.isArray(children) || !children.length || children.length > 20)
      fail("condition groups require 1..20 children");
    const parsed = children.map((child) => condition(child, budget, depth + 1));
    return name === "all" ? { all: parsed } : { any: parsed };
  }
  keys(value, ["attribute", "op", "value"]);
  const attribute = value.attribute;
  if (
    !Array.isArray(attribute) ||
    !attribute.length ||
    attribute.length > 8 ||
    !attribute.every(
      (key) => shortString(key) && !["__proto__", "prototype", "constructor"].includes(key)
    )
  )
    fail("attribute requires 1..8 safe path segments of 1..128 characters");
  const path = attribute.slice() as string[];
  const operand = value.value;
  switch (value.op) {
    case "eq":
      if (!scalar(operand)) fail("eq requires a bounded scalar");
      return { attribute: path, op: "eq", value: operand };
    case "in":
      if (
        !Array.isArray(operand) ||
        !operand.length ||
        operand.length > 100 ||
        !operand.every(scalar)
      )
        fail("in requires 1..100 bounded scalars");
      return { attribute: path, op: "in", value: operand.slice() };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      if (typeof operand !== "number" || !Number.isFinite(operand))
        fail("numeric comparison requires a finite number");
      return { attribute: path, op: value.op, value: operand };
    case "semverEq":
    case "semverGt":
    case "semverGte":
    case "semverLt":
    case "semverLte":
      if (typeof operand !== "string" || !strictSemver(operand))
        fail("version comparison requires strict SemVer");
      return { attribute: path, op: value.op, value: operand };
    default:
      return fail("unsupported condition operator");
  }
}

function scalar(value: unknown): value is ConditionScalar {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 4096)
  );
}
function shortString(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= 128;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("unknown targeting field");
}
function fail(message: string): never {
  throw new LocalProviderError(
    LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR,
    `Invalid targeting: ${message}.`
  );
}
