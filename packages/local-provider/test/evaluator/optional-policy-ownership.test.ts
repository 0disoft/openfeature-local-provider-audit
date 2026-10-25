import { createSnapshotHash } from "../../src/audit/audit-event.js";
import { expect, it } from "vitest";
import { evaluateFlag } from "../../src/index.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";
import { evaluateFlag as evaluateCore } from "../../src/core.js";
import type { FlagSnapshot } from "../../src/core-types.js";

const request = {
  flagKey: "feature",
  expectedType: "boolean" as const,
  defaultValue: false,
  targetingKey: "user",
  evaluationTime: 10,
  context: { allowed: true }
};
const flag = { type: "boolean", variants: { on: true, off: false }, defaultVariant: "off" };
const when = { attribute: ["allowed"], op: "eq", value: true };
function snapshot(extra = {}, version = 2) {
  return validateFlagSnapshot({
    schemaVersion: version,
    flags: { feature: { ...flag, ...extra } }
  });
}
function evaluate(input: FlagSnapshot) {
  return [evaluateFlag(input, request), evaluateCore(input, request)];
}
function inherited<T>(key: string, descriptor: PropertyDescriptor, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    Object.defineProperty(Object.prototype, key, { configurable: true, ...descriptor });
    return run();
  } finally {
    if (previous) Object.defineProperty(Object.prototype, key, previous);
    else Reflect.deleteProperty(Object.prototype, key);
  }
}
it.each([
  ["disabledVariant", "on"],
  ["rules", [{ id: "injected", when, variant: "on" }]],
  ["rollout", [{ variant: "on", percentage: 100 }]],
  ["schedule", { variant: "on", stages: [{ at: 0, percentage: 100 }] }],
  ["metadata", { injected: "untrusted" }]
])("ignores inherited %s introduced after validation without changing the hash", (key, value) => {
  const input = snapshot();
  const expected = evaluate(input);
  const hash = createSnapshotHash(input);
  const result = inherited(String(key), { value }, () => ({
    decisions: evaluate(input),
    hash: createSnapshotHash(input)
  }));
  expect(result).toEqual({ decisions: expected, hash });
});
it.each(["disabledVariant", "rules", "rollout", "schedule", "metadata"])(
  "never invokes inherited %s getters",
  (key) => {
    const input = snapshot();
    const expected = evaluate(input);
    const result = inherited(
      key,
      {
        get() {
          throw new Error("inherited getter invoked");
        }
      },
      () => evaluate(input)
    );
    expect(result).toEqual(expected);
  }
);
it("does not reinterpret a targeting rollout as an inherited direct variant", () => {
  const input = snapshot({
    rules: [{ id: "own", when, rollout: [{ variant: "off", percentage: 100 }] }]
  });
  const expected = evaluate(input);
  expect(inherited("variant", { value: "on" }, () => evaluate(input))).toEqual(expected);
});
it("keeps unallocated rollout buckets at the default despite an inherited variant", () => {
  const input = snapshot({ rollout: [{ variant: "on", percentage: 0.001 }] });
  const expected = evaluate(input);
  expect(inherited("variant", { value: "on" }, () => evaluate(input))).toEqual(expected);
});
it.each([
  { rollout: [{ variant: "on", percentage: 50 }] },
  { rules: [{ id: "own", when, rollout: [{ variant: "on", percentage: 50 }] }] },
  { schedule: { variant: "on", stages: [{ at: 0, percentage: 50 }] } }
])("uses the configured default seed despite inherited seed for %j", (extra) => {
  const input = snapshot(extra);
  const expected = evaluate(input);
  expect(inherited("seed", { value: "injected-seed" }, () => evaluate(input))).toEqual(expected);
});
it("keeps explicit own policies ahead of inherited values and preserves v1 behavior", () => {
  const disabled = snapshot({ disabledVariant: "off", metadata: { own: true } });
  const v1 = snapshot({}, 1);
  const expected = [evaluate(disabled), evaluate(v1)];
  const actual = inherited("disabledVariant", { value: "on" }, () => [
    evaluate(disabled),
    evaluate(v1)
  ]);
  expect(actual).toEqual(expected);
});

it("keeps indexed and linear rollouts on the same default seed", () => {
  const extra = {
    rollout: Array.from({ length: 16 }, (_, index) => ({
      variant: index % 2 ? "on" : "off",
      percentage: 6.25
    }))
  };
  const input = snapshot(extra);
  const expected = evaluate(input);
  const actual = inherited(
    "seed",
    {
      get() {
        throw new Error("inherited seed invoked");
      }
    },
    () => {
      return [evaluate(input), evaluate(snapshot(extra))];
    }
  );
  expect(actual).toEqual([expected, expected]);
});

it("ignores inherited global override errors on captured override state", () => {
  const input = snapshot();
  const ownedRequest = { ...request, overrides: { values: {}, errors: {} } };
  const run = () => [evaluateFlag(input, ownedRequest), evaluateCore(input, ownedRequest)];
  const expected = run();
  expect(
    inherited(
      "globalError",
      {
        get() {
          throw new Error("inherited error invoked");
        }
      },
      run
    )
  ).toEqual(expected);
});

it("rejects malformed direct-caller rules instead of consuming an inherited rollout", () => {
  const input = {
    schemaVersion: 2,
    flags: { feature: { ...flag, rules: [{ id: "invalid", when }] } }
  } as unknown as FlagSnapshot;
  for (const engine of [evaluateFlag, evaluateCore]) {
    expect(() =>
      inherited(
        "rollout",
        {
          get() {
            throw new Error("inherited rollout invoked");
          }
        },
        () => engine(input, request)
      )
    ).toThrow("Targeting rollout must be an own property.");
  }
});
