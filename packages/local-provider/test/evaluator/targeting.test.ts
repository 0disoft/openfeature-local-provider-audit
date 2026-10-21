import { describe, expect, it, vi } from "vitest";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  createEnvOverrides,
  createReloadableLocalProvider,
  evaluateFlag,
  parseJsonFlagSnapshot,
  parseYamlFlagSnapshot
} from "../../src/index.js";

const leaf = { attribute: ["tenant"], op: "eq", value: "pilot" };
const rule = { id: "pilot", when: leaf, variant: "on" };
const flag = {
  type: "boolean",
  defaultVariant: "off",
  envVar: "FLAG",
  variants: { on: true, off: false }
};
function snapshot(extra: object = {}, version = 2) {
  return parseJsonFlagSnapshot(
    JSON.stringify({ schemaVersion: version, flags: { test: { ...flag, ...extra } } })
  );
}
const request = {
  flagKey: "test",
  expectedType: "boolean" as const,
  defaultValue: false,
  context: { tenant: "pilot" }
};

describe("bounded local targeting", () => {
  it("preserves v1 and rejects v2 fields in v1", () => {
    expect(evaluateFlag(snapshot({}, 1), request).reason).toBe("STATIC");
    expect(() => snapshot({ rules: [rule] }, 1)).toThrow("unknown");
    expect(() => snapshot({ disabledVariant: "off" }, 1)).toThrow("unknown");
  });

  it("uses ordered first match and clones/freezes v2 snapshots", () => {
    const input = {
      schemaVersion: 2,
      flags: { test: { ...flag, rules: [{ ...rule }, { ...rule, id: "later", variant: "off" }] } }
    };
    const parsed = parseJsonFlagSnapshot(JSON.stringify(input));
    const first = input.flags.test.rules[0];
    if (first) first.variant = "off";
    expect(Object.isFrozen(parsed.flags.test?.rules?.[0]?.when)).toBe(true);
    expect(evaluateFlag(parsed, request)).toMatchObject({
      value: true,
      variant: "on",
      ruleId: "pilot",
      reason: "TARGETING_MATCH"
    });
    expect(evaluateFlag(parsed, { ...request, context: {} })).toMatchObject({
      value: false,
      reason: "STATIC"
    });
    expect(parseYamlFlagSnapshot("schemaVersion: 2\nflags: {}\n").schemaVersion).toBe(2);
  });

  it.each([
    ["eq", "pilot", "pilot", true],
    ["eq", null, null, true],
    ["eq", null, undefined, false],
    ["in", ["pilot", "beta"], "beta", true],
    ["in", [1], "1", false],
    ["gt", 2, 3, true],
    ["gte", 2, 2, true],
    ["lt", 2, 1, true],
    ["lte", 2, 2, true],
    ["gt", 2, "3", false],
    ["gt", 2, Number.NaN, false],
    ["semverGt", "1.9.0", "1.10.0", true],
    ["semverGte", "1.0.0", "1.0.0", true],
    ["semverLt", "1.0.0", "1.0.0-rc.1", true],
    ["semverLte", "1.0.0", "1.0.0", true],
    ["semverEq", "1.0.0+build1", "1.0.0+build2", true],
    ["semverEq", "1.0.0", "v1.0.0", false],
    ["semverEq", "1.0.0", "bad", false],
    ["semverEq", "1.0.0", 1, false],
    ["eq", "pilot", "x".repeat(4097), false]
  ])("compares %s without coercion (%j / %j)", (op, value, actual, matches) => {
    const parsed = snapshot({ rules: [{ ...rule, when: { attribute: ["tenant"], op, value } }] });
    expect(evaluateFlag(parsed, { ...request, context: { tenant: actual } }).value).toBe(matches);
  });

  it("handles bounded groups, nested own data fields and explicit targeting key", () => {
    const parsed = snapshot({
      rules: [
        {
          ...rule,
          when: {
            all: [
              { any: [leaf, { ...leaf, value: "beta" }] },
              { attribute: ["app", "version"], op: "semverGte", value: "2.0.0" },
              { attribute: ["targetingKey"], op: "eq", value: "explicit" }
            ]
          }
        }
      ]
    });
    expect(
      evaluateFlag(parsed, {
        ...request,
        targetingKey: "explicit",
        context: { tenant: "beta", app: { version: "2.1.0" }, targetingKey: "other" }
      }).value
    ).toBe(true);
    expect(evaluateFlag(parsed, { ...request, targetingKey: "explicit" }).value).toBe(false);
  });

  it("does not invoke context getters, walk prototypes or traverse unrelated cycles", () => {
    const parsed = snapshot({ rules: [rule] });
    const getter = vi.fn(() => "pilot");
    expect(
      evaluateFlag(parsed, {
        ...request,
        context: Object.defineProperty({}, "tenant", { get: getter })
      }).value
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(
      evaluateFlag(parsed, { ...request, context: Object.create({ tenant: "pilot" }) }).value
    ).toBe(false);
    const cyclic: Record<string, unknown> = { tenant: "pilot" };
    cyclic.self = cyclic;
    expect(evaluateFlag(parsed, { ...request, context: cyclic }).value).toBe(true);
  });

  it("prioritizes emergency selection over overrides/errors but preserves type checking", () => {
    const normal = snapshot({ rules: [rule] });
    const overrides = createEnvOverrides(normal, { env: { FLAG: "false" } });
    expect(evaluateFlag(normal, { ...request, overrides }).reason).toBe("ENV_OVERRIDE");
    const stopped = snapshot({ rules: [rule], disabledVariant: "off" });
    const invalid = createEnvOverrides(stopped, { overridesJson: "bad" });
    expect(
      evaluateFlag(stopped, { ...request, defaultValue: true, overrides: invalid })
    ).toMatchObject({ value: false, reason: "DISABLED", variant: "off" });
    expect(
      evaluateFlag(stopped, { flagKey: "test", expectedType: "string", defaultValue: "fallback" })
        .errorCode
    ).toBe("TYPE_MISMATCH");
  });

  it("uses existing buckets and does not continue after an unallocated rule", () => {
    const rollout = [{ variant: "on", percentage: 20, seed: "shared" }];
    const targeted = snapshot({
      rules: [
        { id: "roll", when: leaf, rollout },
        { ...rule, id: "later" }
      ]
    });
    const legacy = snapshot({ rollout }, 1);
    let selectedCount = 0;
    for (let i = 0; i < 100; i++) {
      const input = { ...request, targetingKey: `subject-${i}` };
      const selected = evaluateFlag(targeted, input);
      expect(selected.value).toBe(evaluateFlag(legacy, input).value);
      expect(selected.ruleId).toBe("roll");
      if (selected.value) selectedCount++;
    }
    expect(selectedCount).toBeGreaterThan(0);
    expect(selectedCount).toBeLessThan(100);
    expect(evaluateFlag(targeted, request)).toMatchObject({
      errorCode: "INVALID_CONTEXT",
      ruleId: "roll"
    });
    const expanded = snapshot({
      rules: [{ id: "roll", when: leaf, rollout: [{ ...rollout[0], percentage: 50 }] }]
    });
    for (let i = 0; i < 100; i++) {
      const input = { ...request, targetingKey: `subject-${i}` };
      if (evaluateFlag(targeted, input).value)
        expect(evaluateFlag(expanded, input).value).toBe(true);
    }
  });

  it.each([
    { rules: [{ ...rule, typo: true }] },
    { rules: [{ ...rule, when: { ...leaf, typo: true } }] },
    { rules: [rule, rule] },
    { rules: Array.from({ length: 101 }, (_, i) => ({ ...rule, id: `${i}` })) },
    { rules: [{ ...rule, id: "" }] },
    { rules: [{ ...rule, variant: "missing" }] },
    { rules: [{ ...rule, rollout: [{ variant: "on", percentage: 1 }] }] },
    { rules: [{ id: "empty", when: leaf }] },
    { disabledVariant: "missing" },
    ...[
      [],
      ["__proto__"],
      ["constructor"],
      ["prototype"],
      Array(9).fill("x"),
      ["x".repeat(129)]
    ].map((attribute) => ({ rules: [{ ...rule, when: { ...leaf, attribute } }] })),
    ...["bad", "v1.0.0", "01.0.0", "1.0.0 ", "x".repeat(257)].map((value) => ({
      rules: [{ ...rule, when: { ...leaf, op: "semverEq", value } }]
    })),
    { rules: [{ ...rule, when: { ...leaf, op: "unknown" } }] },
    { rules: [{ ...rule, when: { ...leaf, op: "gt", value: "2" } }] },
    { rules: [{ ...rule, when: { ...leaf, value: {} } }] },
    { rules: [{ ...rule, when: { ...leaf, op: "in", value: [] } }] },
    { rules: [{ ...rule, when: { all: [] } }] },
    { rules: [{ ...rule, when: { any: Array(21).fill(leaf) } }] },
    { rules: [{ ...rule, when: { all: [leaf], any: [leaf] } }] },
    {
      rules: [
        {
          ...rule,
          when: Array.from({ length: 8 }).reduce<object>((child) => ({ all: [child] }), leaf)
        }
      ]
    },
    { rules: [{ ...rule, when: { all: Array(10).fill({ all: Array(10).fill(leaf) }) } }] },
    { rollout: Array(101).fill({ variant: "on", percentage: 0.001 }) }
  ])("rejects invalid or excessive v2 input %j", (extra) => {
    expect(() => snapshot(extra)).toThrow();
  });

  it("integrates targeting and emergency reload with the real OpenFeature SDK", async () => {
    const provider = createReloadableLocalProvider({
      snapshot: snapshot({ rules: [rule] }),
      env: {}
    });
    await OpenFeature.setProviderAndWait("targeting-contract", provider);
    const client = OpenFeature.getClient("targeting-contract");
    try {
      expect(await client.getBooleanDetails("test", false, { tenant: "pilot" })).toMatchObject({
        value: true,
        reason: "TARGETING_MATCH",
        flagMetadata: { localProviderRuleId: "pilot" }
      });
      provider.updateSnapshot(snapshot({ disabledVariant: "off" }));
      expect(await client.getBooleanDetails("test", true, { tenant: "pilot" })).toMatchObject({
        value: false,
        reason: "DISABLED"
      });
    } finally {
      await OpenFeature.clearProviders();
    }
  });
});
