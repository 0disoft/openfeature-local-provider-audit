import { expect, it } from "vitest";
import { evaluateFlag, explainEvaluation, replayEvaluationFixture } from "../../src/index.js";
import {
  evaluateFlag as coreEvaluate,
  parseJsonFlagSnapshot as coreParse
} from "../../src/core.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";

const eq = { attribute: ["tenant"], op: "eq", value: "blocked" };
const exists = (value = true) => ({ attribute: ["tenant"], op: "exists", value });
const request = { flagKey: "feature", expectedType: "boolean" as const, defaultValue: false };
function snapshot(when: unknown) {
  return validateFlagSnapshot({
    schemaVersion: 2,
    flags: {
      feature: {
        type: "boolean",
        variants: { on: true, off: false },
        defaultVariant: "off",
        rules: [{ id: "predicate", when, variant: "on" }]
      }
    }
  });
}
function check(when: unknown, context: unknown, expected: boolean) {
  const parsed = snapshot(when);
  const input = { ...request, context: context as Record<string, unknown> };
  expect(evaluateFlag(parsed, input).value).toBe(expected);
  expect(coreEvaluate(coreParse(JSON.stringify(parsed)), input).value).toBe(expected);
}

it.each([
  [undefined, false, true],
  [{}, false, true],
  [{ tenant: undefined }, false, true],
  [{ tenant: null }, true, false],
  [{ tenant: false }, true, false],
  [{ tenant: 0 }, true, false],
  [{ tenant: "" }, true, false],
  [{ tenant: {} }, true, false],
  [{ tenant: [] }, true, false],
  [{ tenant: "x".repeat(4096) }, true, false],
  [{ tenant: "x".repeat(4097) }, false, false],
  [{ tenant: NaN }, false, false],
  [{ tenant: Infinity }, false, false],
  [{ tenant: 1n }, false, false],
  [{ tenant: Symbol() }, false, false],
  [{ tenant: () => 1 }, false, false],
  [null, false, false],
  [1, false, false],
  [Object.create({ tenant: "inherited" }), false, false]
])("defines safe presence %#", (context, present, absent) => {
  check(exists(), context, present as boolean);
  check(exists(false), context, absent as boolean);
  check({ not: exists() }, context, absent as boolean);
  check({ not: exists(false) }, context, present as boolean);
});

it.each([
  [eq, { tenant: "allowed" }, true],
  [eq, { tenant: "blocked" }, false],
  [eq, {}, false],
  [eq, { tenant: undefined }, false],
  [eq, { tenant: null }, false],
  [eq, { tenant: 1 }, false],
  [eq, { tenant: {} }, false],
  [eq, { tenant: "x".repeat(4097) }, false],
  [{ attribute: ["tenant"], op: "in", value: ["a", "b"] }, { tenant: "c" }, true],
  [{ attribute: ["tenant"], op: "in", value: ["a", "b"] }, { tenant: false }, false],
  [{ attribute: ["tenant"], op: "in", value: ["a", false] }, { tenant: true }, true],
  [{ attribute: ["tenant"], op: "gte", value: 1 }, { tenant: 0 }, true],
  [{ attribute: ["tenant"], op: "gte", value: 1 }, { tenant: "0" }, false],
  [{ attribute: ["tenant"], op: "gte", value: 1 }, { tenant: NaN }, false],
  [{ attribute: ["tenant"], op: "eq", value: null }, { tenant: null }, false],
  [{ attribute: ["tenant"], op: "eq", value: null }, { tenant: false }, false],
  [{ attribute: ["tenant"], op: "startsWith", value: "prod-" }, { tenant: "test-a" }, true],
  [{ attribute: ["tenant"], op: "endsWith", value: ".local" }, { tenant: 3 }, false],
  [{ attribute: ["tenant"], op: "semverGte", value: "2.0.0" }, { tenant: "1.0.0" }, true],
  [{ attribute: ["tenant"], op: "semverGte", value: "2.0.0" }, { tenant: "bad" }, false],
  [{ attribute: ["tenant"], op: "semverEq", value: "2.0.0" }, { tenant: "x".repeat(257) }, false]
])("negates only valid typed comparisons %#", (condition, context, expected) => {
  check({ not: condition }, context, expected as boolean);
});

it("propagates invalidity through nested and double negation, regardless of sibling order", () => {
  const missing = { attribute: ["missing"], op: "eq", value: "x" };
  for (const name of ["all", "any"])
    for (const tenant of ["blocked", "allowed"]) {
      for (const children of [
        [eq, missing],
        [missing, eq]
      ]) {
        check({ not: { [name]: children } }, { tenant }, false);
        check({ not: { not: { [name]: children } } }, { tenant }, false);
      }
    }
  // Ordinary positive groups retain their original short-circuit semantics.
  check({ any: [eq, missing] }, { tenant: "blocked" }, true);
  check({ not: { all: [eq, exists()] } }, { tenant: "allowed" }, true);
});

it("does not invoke own/inherited getters and rejects throwing descriptor/has traps", () => {
  let calls = 0;
  const getter = Object.defineProperty({}, "tenant", {
    get() {
      calls++;
      return "allowed";
    }
  });
  const inherited = Object.create(getter);
  const descriptorTrap = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error("private");
      }
    }
  );
  const hasTrap = new Proxy(
    {},
    {
      has() {
        throw new Error("private");
      }
    }
  );
  for (const context of [getter, inherited, descriptorTrap, hasTrap]) {
    check(exists(), context, false);
    check(exists(false), context, false);
    check({ not: eq }, context, false);
    check({ not: exists(false) }, context, false);
  }
  expect(calls).toBe(0);
});

it.each([
  [{}, true],
  [{ tenant: undefined }, true],
  [{ tenant: {} }, true],
  [{ tenant: { id: undefined } }, true],
  [{ tenant: null }, false],
  [{ tenant: false }, false],
  [{ tenant: { id: null } }, false],
  [{ tenant: Object.create({ id: 1 }) }, false]
])("distinguishes missing from invalid intermediate paths %#", (context, expected) => {
  check({ attribute: ["tenant", "id"], op: "exists", value: false }, context, expected as boolean);
});

it("retains explicit targeting-key precedence and live context reads", () => {
  const parsed = snapshot({ attribute: ["targetingKey"], op: "exists", value: false });
  expect(evaluateFlag(parsed, { ...request, targetingKey: "", context: {} }).value).toBe(false);
  expect(evaluateFlag(parsed, { ...request, context: {} }).value).toBe(true);
  expect(evaluateFlag(parsed, { ...request, context: { targetingKey: null } }).value).toBe(false);
  const context = { tenant: "allowed" };
  const negative = snapshot({ not: eq });
  expect(evaluateFlag(negative, { ...request, context }).value).toBe(true);
  context.tenant = "blocked";
  expect(evaluateFlag(negative, { ...request, context }).value).toBe(false);
});

it("rejects inherited/accessor request fields without invoking envelope getters", () => {
  let calls = 0;
  const getter = {
    get() {
      calls++;
      return "private";
    }
  };
  for (const field of ["targetingKey", "context"]) {
    const own = Object.defineProperty({ ...request }, field, getter);
    const inherited = Object.setPrototypeOf({ ...request }, { [field]: "private" });
    const parsed = snapshot({ attribute: ["targetingKey"], op: "exists", value: false });
    for (const input of [own, inherited]) {
      expect(evaluateFlag(parsed, input).value).toBe(false);
      const negative = snapshot({
        not: { attribute: ["targetingKey"], op: "exists", value: true }
      });
      expect(evaluateFlag(negative, input).value).toBe(false);
    }
  }
  const parsed = snapshot({ attribute: ["targetingKey"], op: "exists", value: false });
  expect(
    evaluateFlag(
      parsed,
      Object.defineProperty(
        {
          ...request,
          context: { targetingKey: "context" }
        },
        "targetingKey",
        { value: undefined }
      )
    ).value
  ).toBe(false);
  expect(
    evaluateFlag(parsed, { ...request, targetingKey: 1 } as unknown as typeof request).value
  ).toBe(false);
  expect(calls).toBe(0);
});

it("ignores inherited not dispatch after snapshot validation", () => {
  const parsed = snapshot(eq);
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "not");
  let calls = 0;
  try {
    Object.defineProperty(Object.prototype, "not", {
      configurable: true,
      get() {
        calls++;
        throw new Error("inherited not");
      }
    });
    expect(evaluateFlag(parsed, { ...request, context: { tenant: "blocked" } }).value).toBe(true);
    expect(calls).toBe(0);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "not", original);
    else Reflect.deleteProperty(Object.prototype, "not");
  }
});

it("keeps malformed schemas, v1, depth and node budgets closed", () => {
  for (const condition of [
    { not: [] },
    { not: eq, any: [eq] },
    exists("true" as unknown as boolean),
    { attribute: ["tenant"], op: "exists" },
    { not: null },
    { attribute: ["constructor"], op: "exists", value: false }
  ])
    expect(() => snapshot(condition)).toThrow();
  let nested: unknown = exists();
  for (let depth = 1; depth < 8; depth++) nested = { not: nested };
  expect(() => snapshot(nested)).not.toThrow();
  expect(() => snapshot({ not: nested })).toThrow();
  const nodes100 = {
    all: Array.from({ length: 5 }, (_, i) => ({
      all: Array.from({ length: i ? 19 : 18 }, () => exists())
    }))
  };
  expect(() => snapshot(nodes100)).not.toThrow();
  expect(() => snapshot({ not: nodes100 })).toThrow();
  expect(() => validateFlagSnapshot({ ...snapshot(exists()), schemaVersion: 1 })).toThrow();
});

it("retains priority, override precedence, replay and redacted explanations", () => {
  const parsed = snapshot({ not: eq });
  const input = { ...request, context: { tenant: "private-allowed" } };
  expect(evaluateFlag(parsed, input)).toMatchObject({ value: true, ruleId: "predicate" });
  expect(JSON.stringify(explainEvaluation(parsed, input))).not.toContain("private-allowed");
  expect(
    replayEvaluationFixture({
      schemaVersion: 1,
      name: "negation",
      snapshot: parsed,
      request: input,
      expected: {
        value: true,
        variant: "on",
        reason: "TARGETING_MATCH",
        source: "file",
        ruleId: "predicate"
      }
    }).passed
  ).toBe(true);
  expect(
    evaluateFlag(parsed, { ...input, overrides: { values: { feature: false }, errors: {} } }).reason
  ).toBe("ENV_OVERRIDE");
});
