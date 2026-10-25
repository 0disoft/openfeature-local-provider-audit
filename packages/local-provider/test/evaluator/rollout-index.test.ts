import { afterEach, expect, it, vi } from "vitest";
import { parseJsonFlagSnapshot } from "../../src/flags/parse-json-snapshot.js";
import { selectRolloutVariant } from "../../src/evaluator/bucketing-rules.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { evaluateFlag as evaluateCore } from "../../src/core.js";
import type { PercentageRolloutRule } from "../../src/core-types.js";

afterEach(() => vi.restoreAllMocks());
function snapshot(rollout: readonly PercentageRolloutRule[], version = 1) {
  const flag = { type: "boolean", variants: { a: true, b: false }, defaultVariant: "b" };
  return parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion: version,
      flags: {
        f: {
          ...flag,
          ...(version === 1
            ? { rollout }
            : {
                rules: [
                  {
                    id: "r",
                    when: {
                      attribute: ["targetingKey"],
                      op: "eq",
                      value: "subject"
                    },
                    rollout
                  }
                ]
              })
        }
      }
    })
  );
}
function rolloutOf(count: number): PercentageRolloutRule[] {
  return Array.from({ length: count }, (_, i) => ({
    variant: i % 2 ? "b" : "a",
    percentage: 0.001
  }));
}
it("precomputes 20,000 validated thresholds instead of rounding them on each evaluation", () => {
  const rollout = snapshot(rolloutOf(20_000)).flags.f?.rollout;
  if (rollout === undefined) throw new Error("Missing rollout fixture.");
  const round = vi.spyOn(Math, "round");
  let buckets = 0;
  const result = selectRolloutVariant("f", "subject", rollout, (_flag, _key, seed) => {
    expect(seed).toBe("v1");
    buckets++;
    return 99_999;
  });
  expect(result).toEqual({ bucket: 99_999 });
  expect(buckets).toBe(1);
  expect(round).not.toHaveBeenCalled();
});
it.each([15, 16, 100])(
  "matches the original cumulative rules at every bucket for %i entries",
  (count) => {
    const input = Array.from({ length: count }, (_, i) => ({
      variant: i % 2 ? "b" : "a",
      percentage: 0.001 * (i + 1),
      ...(i === count - 1 ? { seed: "shared" } : {})
    }));
    const rollout = snapshot(input).flags.f?.rollout;
    if (rollout === undefined) throw new Error("Missing rollout fixture.");
    let seed: string | undefined;
    const actual = Array.from(
      { length: 100_000 },
      (_, bucket) =>
        selectRolloutVariant("f", "subject", rollout, (_flag, _key, value) => {
          seed = value;
          return bucket;
        }).variant
    );
    let lower = 0;
    const expected: (string | undefined)[] = Array(100_000).fill(undefined);
    for (const rule of input) {
      const upper = lower + Math.round(rule.percentage * 1000);
      expected.fill(rule.variant, lower, upper);
      lower = upper;
    }
    expect(actual).toEqual(expected);
    expect(seed).toBe("shared");
  }
);
it.each([false, true])("keeps caller-owned arrays uncached (shallow freeze: %s)", (frozen) => {
  const rules = rolloutOf(20);
  if (frozen) Object.freeze(rules);
  expect(selectRolloutVariant("f", "subject", rules, () => 0).variant).toBe("a");
  const first = rules[0];
  if (first === undefined) throw new Error("Missing first rule.");
  Object.assign(first, { variant: "b", percentage: 0.002, seed: "new" });
  let seed: string | undefined;
  expect(
    selectRolloutVariant("f", "subject", rules, (_flag, _key, value) => {
      seed = value;
      return 1;
    }).variant
  ).toBe("b");
  expect(seed).toBe("new");
});
it("builds independent indexes for replacement snapshots and v2 conditional rollouts", () => {
  const input = rolloutOf(20);
  input[0] = { variant: "b", percentage: 0.001 };
  const a = snapshot(rolloutOf(20));
  const b = snapshot(input);
  expect(selectRolloutVariant("f", "subject", a.flags.f?.rollout ?? [], () => 0).variant).toBe("a");
  expect(selectRolloutVariant("f", "subject", b.flags.f?.rollout ?? [], () => 0).variant).toBe("b");
  const conditional = snapshot(rolloutOf(100), 2);
  const request = {
    flagKey: "f",
    expectedType: "boolean" as const,
    defaultValue: true,
    targetingKey: "subject"
  };
  expect(evaluateCore(conditional, request)).toEqual(evaluateFlag(conditional, request));
  expect(evaluateFlag(conditional, request)).toMatchObject({ ruleId: "r" });
  expect(evaluateFlag(conditional, request).errorCode).toBeUndefined();
  const round = vi.spyOn(Math, "round");
  selectRolloutVariant(
    "f",
    "subject",
    conditional.flags.f?.rules?.[0]?.rollout ?? [],
    () => 99_999
  );
  expect(round).not.toHaveBeenCalled();
});

it("preserves strict upper boundaries and complete 100-percent coverage for indexed rules", () => {
  const input = Array.from({ length: 16 }, (_, i) => ({
    variant: i % 2 ? "b" : "a",
    percentage: 6.25
  }));
  const rollout = snapshot(input).flags.f?.rollout;
  if (rollout === undefined) throw new Error("Missing rollout fixture.");
  for (let stage = 0; stage < 16; stage++) {
    for (const bucket of [stage * 6250, (stage + 1) * 6250 - 1])
      expect(selectRolloutVariant("f", "subject", rollout, () => bucket).variant).toBe(
        input[stage]?.variant
      );
  }
  expect(selectRolloutVariant("f", "subject", rollout, () => 100_000)).toEqual({ bucket: 100_000 });
});
