import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";

const ajv = new Ajv({ strict: true, allErrors: true });
const validators = [1, 2].map((version) =>
  ajv.compile(
    JSON.parse(readFileSync(new URL(`../../schemas/v${version}.json`, import.meta.url), "utf8"))
  )
);
const flag = () => ({ type: "boolean", variants: { on: true, off: false }, defaultVariant: "off" });
const snapshot = (version = 2, definition: object = flag()) => ({
  schemaVersion: version,
  flags: { feature: definition }
});
const matches = (value: unknown, version = 2) => validators[version - 1]?.(value);
const rule = {
  id: "region",
  when: { attribute: ["region"], op: "eq", value: "KR" },
  variant: "on"
};

describe("packaged authoring schemas", () => {
  it.each([127, 128, 129, 256, 4096])(
    "accepts runtime-valid targeting variant references of %i characters",
    (length) => {
      const name = "v".repeat(length);
      const value = snapshot(2, {
        ...flag(),
        variants: { [name]: true, off: false },
        rules: [{ ...rule, variant: name }]
      });
      const validated = validateFlagSnapshot(value);
      expect(
        evaluateFlag(validated, {
          flagKey: "feature",
          expectedType: "boolean",
          defaultValue: false,
          context: { region: "KR" }
        })
      ).toMatchObject({ value: true, variant: name, reason: "TARGETING_MATCH" });
      expect(matches(value), JSON.stringify(validators[1]?.errors)).toBe(true);
    }
  );

  it.each([
    { length: 127, accepted: true },
    { length: 128, accepted: true },
    { length: 129, accepted: false }
  ])("retains the rule-ID boundary at $length characters", ({ length, accepted }) => {
    const value = snapshot(2, { ...flag(), rules: [{ ...rule, id: "r".repeat(length) }] });
    if (accepted) expect(() => validateFlagSnapshot(value)).not.toThrow();
    else expect(() => validateFlagSnapshot(value)).toThrow();
    expect(matches(value)).toBe(accepted);
  });

  it("still requires long variant references to exist at runtime", () => {
    const value = snapshot(2, { ...flag(), rules: [{ ...rule, variant: "missing".repeat(20) }] });
    expect(() => validateFlagSnapshot(value)).toThrow("rule variant must exist");
    // Cross-reference validation stays at runtime, just as for shorter names.
    expect(matches(value)).toBe(true);
  });

  it.each([1, 2])("accepts runtime-valid v%i values, long keys and JSON variants", (version) => {
    const value = {
      schemaVersion: version,
      metadata: { count: 1, text: "value", enabled: true },
      flags: {
        ["long".repeat(100)]: flag(),
        text: { type: "string", variants: { a: "" }, defaultVariant: "a" },
        number: { type: "number", variants: { a: -1.25 }, defaultVariant: "a" },
        object: {
          type: "object",
          variants: { a: { nested: [null, false, { x: 1 }] }, b: [] },
          defaultVariant: "a"
        },
        rollout: {
          ...flag(),
          rollout: [{ variant: "on", percentage: 0.009 }],
          envVar: "ENABLED",
          metadata: {}
        }
      }
    };
    expect(() => validateFlagSnapshot(value)).not.toThrow();
    expect(matches(value, version)).toBe(true);
    expect(matches({ schemaVersion: version, flags: {} }, version)).toBe(true);
  });

  it.each([
    "eq",
    "in",
    "gt",
    "gte",
    "lt",
    "lte",
    "semverEq",
    "semverGt",
    "semverGte",
    "semverLt",
    "semverLte"
  ])("accepts v2 %s conditions and schedules", (op) => {
    const value = snapshot(2, {
      ...flag(),
      disabledVariant: "off",
      rules: [
        {
          ...rule,
          when: {
            all: [
              {
                any: [
                  {
                    attribute: ["value"],
                    op,
                    value:
                      op === "eq"
                        ? null
                        : op === "in"
                          ? [true, 3, "KR", null]
                          : op.startsWith("semver")
                            ? "1.2.3-alpha.1+build"
                            : 1
                  }
                ]
              }
            ]
          }
        }
      ],
      schedule: {
        variant: "on",
        seed: "schedule",
        stages: [
          { at: 0, percentage: 0 },
          { at: Number.MAX_SAFE_INTEGER, percentage: 100 }
        ]
      }
    });
    expect(() => validateFlagSnapshot(value)).not.toThrow();
    expect(matches(value)).toBe(true);
    expect(matches(value, 1)).toBe(false);
  });

  it("preserves the different v1 and v2 rollout entry limits", () => {
    const definition = {
      ...flag(),
      rollout: Array.from({ length: 101 }, () => ({ variant: "on", percentage: 0.001 }))
    };
    expect(() => validateFlagSnapshot(snapshot(1, definition))).not.toThrow();
    expect(matches(snapshot(1, definition), 1)).toBe(true);
    expect(matches(snapshot(2, definition))).toBe(false);
    const value = snapshot(2, {
      ...flag(),
      rules: [{ id: "r", when: rule.when, rollout: [{ variant: "on", percentage: 100 }] }]
    });
    expect(() => validateFlagSnapshot(value)).not.toThrow();
    expect(matches(value)).toBe(true);
  });

  it.each([
    { schemaVersion: 3, flags: {} },
    { schemaVersion: 2, flags: {}, $schema: "unsupported" },
    { schemaVersion: 2, flags: { " ": flag() } },
    snapshot(2, { ...flag(), typo: true }),
    snapshot(2, { ...flag(), variants: {} }),
    snapshot(2, { ...flag(), variants: { on: "true" } }),
    snapshot(2, { type: "object", variants: { a: null }, defaultVariant: "a" }),
    snapshot(2, { ...flag(), metadata: { bad: null } }),
    snapshot(2, { ...flag(), envVar: " " }),
    snapshot(2, { ...flag(), rollout: [] }),
    snapshot(2, { ...flag(), rollout: [{ variant: "on", percentage: 0 }] }),
    snapshot(2, { ...flag(), rollout: [{ variant: "on", percentage: 101 }] }),
    snapshot(2, { ...flag(), rules: [{ ...rule, rollout: [{ variant: "on", percentage: 1 }] }] }),
    snapshot(2, { ...flag(), rules: [{ ...rule, when: { all: [] } }] }),
    snapshot(2, { ...flag(), rules: [{ ...rule, when: { all: [rule.when], any: [rule.when] } }] }),
    snapshot(2, {
      ...flag(),
      rules: [{ ...rule, when: { ...rule.when, attribute: ["__proto__"] } }]
    }),
    snapshot(2, { ...flag(), rules: [{ ...rule, when: { ...rule.when, op: "unknown" } }] }),
    snapshot(2, { ...flag(), rules: [{ ...rule, when: { ...rule.when, op: "in", value: [] } }] }),
    snapshot(2, { ...flag(), rules: [{ ...rule, when: { ...rule.when, op: "gt", value: "3" } }] }),
    snapshot(2, { ...flag(), schedule: { variant: "on", stages: [{ at: -1, percentage: 1 }] } }),
    snapshot(2, { ...flag(), schedule: { variant: "on", stages: [{ at: 0.5, percentage: 1 }] } }),
    snapshot(2, {
      ...flag(),
      rollout: [{ variant: "on", percentage: 1 }],
      schedule: { variant: "on", stages: [{ at: 0, percentage: 1 }] }
    })
  ])("rejects structural errors also rejected at runtime (%#)", (value) => {
    expect(() => validateFlagSnapshot(value)).toThrow();
    expect(matches(value)).toBe(false);
  });

  it.each([
    { ...flag(), defaultVariant: "missing" },
    {
      ...flag(),
      rollout: [
        { variant: "on", percentage: 60 },
        { variant: "off", percentage: 60 }
      ]
    },
    { ...flag(), rollout: [{ variant: "on", percentage: 0.0001 }] },
    {
      ...flag(),
      rollout: [
        { variant: "on", percentage: 10, seed: "a" },
        { variant: "off", percentage: 10, seed: "b" }
      ]
    },
    { ...flag(), rules: [rule, rule] },
    { ...flag(), rules: [{ ...rule, when: { ...rule.when, op: "semverEq", value: "v1.0.0" } }] },
    {
      ...flag(),
      schedule: {
        variant: "on",
        stages: [
          { at: 2, percentage: 20 },
          { at: 1, percentage: 10 }
        ]
      }
    },
    { ...flag(), rules: [{ ...rule, id: "😀".repeat(128) }] }
  ])(
    "documents semantic constraints requiring the authoritative runtime validator (%#)",
    (definition) => {
      const value = snapshot(2, definition);
      expect(matches(value)).toBe(true);
      expect(() => validateFlagSnapshot(value)).toThrow();
    }
  );
});
