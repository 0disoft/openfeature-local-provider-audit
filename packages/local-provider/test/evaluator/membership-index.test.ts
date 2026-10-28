import { afterEach, expect, it, vi } from "vitest";
import { evaluateFlag, explainEvaluation, parseJsonFlagSnapshot } from "../../src/index.js";
import { createSnapshotHash } from "../../src/audit/audit-event.js";
import * as core from "../../src/core.js";
import type { ConditionScalar, FlagSnapshot } from "../../src/core-types.js";
import { matchesCondition } from "../../src/evaluator/conditions.js";

const request = { flagKey: "test", expectedType: "boolean" as const, defaultValue: false };
function input(values: readonly ConditionScalar[], negated = false) {
  const condition = { attribute: ["member"], op: "in", value: values };
  return {
    schemaVersion: 2,
    flags: {
      test: {
        type: "boolean",
        defaultVariant: "off",
        variants: { on: true, off: false },
        rules: [
          { id: "first", when: negated ? { not: condition } : condition, variant: "on" },
          { id: "later", when: { attribute: ["member"], op: "eq", value: "hit" }, variant: "off" }
        ]
      }
    }
  };
}
afterEach(() => vi.restoreAllMocks());

it.each([15, 16, 100])(
  "preserves typed membership, duplicate order, hashes and first-match trace for %s candidates",
  (size) => {
    const values: ConditionScalar[] = Array.from({ length: size - 5 }, (_, i) => `v${i}`);
    values.push("hit", "hit", 0, false, null);
    const serialized = JSON.stringify(input(values));
    const native = parseJsonFlagSnapshot(serialized),
      portable = core.parseJsonFlagSnapshot(serialized);
    for (const actual of [
      "hit",
      "missing",
      0,
      -0,
      "0",
      false,
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
      "x".repeat(4097)
    ]) {
      const evaluation = { ...request, context: { member: actual } };
      const expected = values.some((candidate) => candidate === actual);
      expect(evaluateFlag(native, evaluation).value).toBe(expected);
      expect(core.evaluateFlag(portable, evaluation)).toEqual(evaluateFlag(native, evaluation));
    }
    expect(native).toEqual(JSON.parse(serialized));
    expect(createSnapshotHash(native)).toBe(createSnapshotHash(JSON.parse(serialized)));
    expect(explainEvaluation(native, { ...request, context: { member: "hit" } }).rules).toEqual([
      { ruleId: "first", matched: true }
    ]);
    expect(Object.isFrozen(native.flags.test?.rules?.[0]?.when)).toBe(true);
  }
);

it("uses indexed membership for repeated validated lookups without rescanning candidates", () => {
  const parsed = parseJsonFlagSnapshot(
    JSON.stringify(input(Array.from({ length: 100 }, (_, i) => `v${i}`)))
  );
  const condition = parsed.flags.test?.rules?.[0]?.when;
  if (!condition) throw new Error("Missing condition");
  const some = vi.spyOn(Array.prototype, "some");
  for (let index = 0; index < 100; index++)
    expect(matchesCondition(condition, { ...request, context: { member: "v99" } })).toBe(true);
  expect(some).not.toHaveBeenCalled();
});

it("keeps mutable and caller-frozen unvalidated arrays on strict live equality", () => {
  const values: ConditionScalar[] = Array.from({ length: 20 }, (_, i) => i);
  const mutable = input(values) as FlagSnapshot;
  expect(evaluateFlag(mutable, { ...request, context: { member: 19 } }).value).toBe(true);
  values[19] = "changed";
  expect(evaluateFlag(mutable, { ...request, context: { member: 19 } }).value).toBe(false);
  expect(evaluateFlag(mutable, { ...request, context: { member: "changed" } }).value).toBe(true);
  values.push(Number.NaN);
  Object.freeze(values);
  expect(evaluateFlag(mutable, { ...request, context: { member: Number.NaN } }).value).toBe(false);
});

it("does not rescan candidate types inside validated negation", () => {
  const values: ConditionScalar[] = Array.from({ length: 99 }, (_, i) => `v${i}`);
  values.push(0);
  const parsed = parseJsonFlagSnapshot(JSON.stringify(input(values, true)));
  const condition = parsed.flags.test?.rules?.[0]?.when;
  if (!condition) throw new Error("Missing condition");
  const some = vi.spyOn(Array.prototype, "some");
  for (let index = 0; index < 100; index++) {
    expect(matchesCondition(condition, { ...request, context: { member: 0 } })).toBe(false);
    expect(matchesCondition(condition, { ...request, context: { member: 1 } })).toBe(true);
    expect(matchesCondition(condition, { ...request, context: { member: false } })).toBe(false);
  }
  expect(some).not.toHaveBeenCalled();
});

it.each([15, 16, 100])("preserves guarded negation at the %s-candidate boundary", (size) => {
  const values: ConditionScalar[] = Array.from({ length: size - 5 }, (_, i) => `v${i}`);
  values.push("hit", "hit", 0, false, null);
  const text = JSON.stringify(input(values, true));
  const parsed = parseJsonFlagSnapshot(text),
    portable = core.parseJsonFlagSnapshot(text);
  for (const [actual, expected] of [
    ["hit", false],
    ["missing", true],
    [0, false],
    [-0, false],
    [1, true],
    ["0", true],
    [false, false],
    [true, true],
    [null, false],
    [undefined, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [{}, false],
    ["x".repeat(4097), false]
  ]) {
    const evaluation = { ...request, context: { member: actual } };
    expect(evaluateFlag(parsed, evaluation).value).toBe(expected);
    expect(core.evaluateFlag(portable, evaluation)).toEqual(evaluateFlag(parsed, evaluation));
  }
  expect(createSnapshotHash(parsed)).toBe(createSnapshotHash(JSON.parse(text)));
});

it("reads mutable and caller-frozen candidate types live under negation", () => {
  const values: ConditionScalar[] = Array.from({ length: 20 }, (_, i) => i);
  const snapshot = input(values, true) as FlagSnapshot;
  const evaluation = { ...request, context: { member: "changed" } };
  expect(evaluateFlag(snapshot, evaluation).value).toBe(false);
  values[19] = "other";
  expect(evaluateFlag(snapshot, evaluation).value).toBe(true);
  values[19] = "changed";
  Object.freeze(values);
  expect(evaluateFlag(snapshot, evaluation).value).toBe(false);
  expect(evaluateFlag(snapshot, { ...request, context: { member: "other" } }).value).toBe(true);
});
