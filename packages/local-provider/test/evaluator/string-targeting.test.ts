import { expect, it } from "vitest";
import { evaluateFlag, explainEvaluation, replayEvaluationFixture } from "../../src/index.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";
import {
  evaluateFlag as coreEvaluate,
  parseJsonFlagSnapshot as coreParse
} from "../../src/core.js";
function snapshot(op: string, value: unknown) {
  return validateFlagSnapshot({
    schemaVersion: 2,
    flags: {
      feature: {
        type: "boolean",
        variants: { on: true, off: false },
        defaultVariant: "off",
        rules: [{ id: "literal", when: { attribute: ["tenant"], op, value }, variant: "on" }]
      }
    }
  });
}
const request = { flagKey: "feature", expectedType: "boolean" as const, defaultValue: false };
it.each([
  ["startsWith", "tenant-", "tenant-prod", true],
  ["startsWith", "tenant-", "Tenant-prod", false],
  ["endsWith", ".internal", "api.internal", true],
  ["endsWith", ".internal", "api.internal.evil", false],
  ["startsWith", "😀", "😀tenant", true],
  ["endsWith", "é", "cafe\u0301", false],
  ["startsWith", ".*", "ordinary", false],
  ["startsWith", ".*", ".*literal", true],
  ["endsWith", " ", "space ", true],
  ["startsWith", "x", "", false]
])("matches %s literal %s without coercion or normalization", (op, value, actual, expected) => {
  const parsed = snapshot(String(op), value),
    context = { tenant: actual };
  expect(evaluateFlag(parsed, { ...request, context }).value).toBe(expected);
  expect(coreEvaluate(coreParse(JSON.stringify(parsed)), { ...request, context }).value).toBe(
    expected
  );
});
it.each([undefined, null, true, 123, ["tenant-"], {}, "x".repeat(4097)])(
  "rejects invalid actual %j",
  (actual) => {
    expect(
      evaluateFlag(snapshot("startsWith", "tenant-"), { ...request, context: { tenant: actual } })
        .value
    ).toBe(false);
  }
);
it.each(["", 1, null, [], "x".repeat(4097)])("rejects invalid operand %j", (value) => {
  expect(() => snapshot("endsWith", value)).toThrow();
});
it("retains exact length boundaries and never invokes inherited or own getters", () => {
  const parsed = snapshot("startsWith", "x".repeat(4096));
  expect(evaluateFlag(parsed, { ...request, context: { tenant: "x".repeat(4096) } }).value).toBe(
    true
  );
  for (const context of [
    Object.create({ tenant: "x".repeat(4096) }),
    Object.defineProperty({}, "tenant", {
      get() {
        throw new Error("must not run");
      }
    })
  ])
    expect(evaluateFlag(parsed, { ...request, context }).value).toBe(false);
});
it("preserves priority, replay and redacted explanation for literal rules", () => {
  const parsed = snapshot("endsWith", ".internal"),
    context = { tenant: "private.internal" };
  const result = evaluateFlag(parsed, { ...request, context });
  expect(result).toMatchObject({ value: true, ruleId: "literal", reason: "TARGETING_MATCH" });
  expect(JSON.stringify(explainEvaluation(parsed, { ...request, context }))).not.toContain(
    "private.internal"
  );
  expect(
    replayEvaluationFixture({
      schemaVersion: 1,
      name: "literal",
      snapshot: parsed,
      request: { ...request, context },
      expected: {
        value: true,
        variant: "on",
        reason: "TARGETING_MATCH",
        source: "file",
        ruleId: "literal"
      }
    }).passed
  ).toBe(true);
  expect(
    evaluateFlag(parsed, {
      ...request,
      context,
      overrides: { values: { feature: false }, errors: {} }
    }).reason
  ).toBe("ENV_OVERRIDE");
  expect(() => validateFlagSnapshot({ ...parsed, schemaVersion: 1 })).toThrow();
});
