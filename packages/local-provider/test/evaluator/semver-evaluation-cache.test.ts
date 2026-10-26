import { beforeEach, expect, it, vi } from "vitest";
import { parseJsonFlagSnapshot } from "../../src/flags/parse-json-snapshot.js";
import { evaluateFlag, evaluateWithTrace } from "../../src/evaluator/evaluate.js";
import { evaluateFlag as evaluateCore } from "../../src/core.js";
const constructions = vi.hoisted(() => ({ values: [] as string[] }));
vi.mock("semver", async (original) => {
  const actual = await original<typeof import("semver")>();
  return {
    ...actual,
    SemVer: class extends actual.SemVer {
      constructor(...args: ConstructorParameters<typeof actual.SemVer>) {
        constructions.values.push(String(args[0]));
        super(...args);
      }
    }
  };
});
beforeEach(() => {
  constructions.values.length = 0;
});
function snapshot(grouped = false, alternating = false) {
  const leaf = (attribute: string) => ({ attribute: [attribute], op: "semverGte", value: "9.0.0" });
  return parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion: 2,
      flags: {
        f: {
          type: "boolean",
          defaultVariant: "off",
          variants: { on: true, off: false },
          rules: Array.from({ length: 100 }, (_, i) => ({
            id: `r${i}`,
            variant: "on",
            when: grouped
              ? {
                  any: [
                    leaf("version"),
                    { all: [{ attribute: ["tenant"], op: "eq", value: "pilot" }, leaf("version")] }
                  ]
                }
              : leaf(alternating && i % 2 ? "other" : "version")
          }))
        }
      }
    })
  );
}
const request = (version: string) => ({
  flagKey: "f",
  expectedType: "boolean" as const,
  defaultValue: true,
  context: { version, tenant: "pilot", other: "3.0.0" }
});
it.each(["2.1.0", "1.0.0-"])(
  "parses repeated actual %s once per evaluation, including rejection",
  (version) => {
    const data = snapshot();
    const input = request(version);
    evaluateFlag(data, input); // Populate the existing per-condition operand cache.
    constructions.values.length = 0;
    expect(evaluateFlag(data, input)).toMatchObject({ value: false, reason: "STATIC" });
    expect(constructions.values).toEqual([version]);
  }
);
it("shares the evaluation cache across groups without changing trace/short circuit decisions", () => {
  const data = snapshot(true);
  const input = request("2.1.0");
  evaluateFlag(data, input);
  constructions.values.length = 0;
  expect(evaluateFlag(data, input).reason).toBe("STATIC");
  expect(constructions.values).toEqual(["2.1.0"]);
  expect(evaluateCore(data, input)).toEqual(evaluateFlag(data, input));
  const trace: [string, boolean][] = [];
  evaluateWithTrace(data, input, (id, matched) => trace.push([id, matched]));
  expect(trace).toEqual(Array.from({ length: 100 }, (_, i) => [`r${i}`, false]));
});
it("re-reads context and does not retain cached versions across evaluations of the same request", () => {
  const data = snapshot();
  const input = request("2.1.0");
  expect(evaluateFlag(data, input).value).toBe(false);
  input.context.version = "10.0.0";
  expect(evaluateFlag(data, input)).toMatchObject({ value: true, ruleId: "r0" });
  input.context.version = "1.0.0-";
  expect(evaluateFlag(data, input).value).toBe(false);
});
it.each(["3.0.0", "1.0.0-"])("reuses two alternating actual strings, including %s", (other) => {
  const data = snapshot(false, true);
  const input = request("2.1.0");
  input.context.other = other;
  evaluateFlag(data, input);
  constructions.values.length = 0;
  expect(evaluateFlag(data, input).reason).toBe("STATIC");
  expect(constructions.values).toEqual(["2.1.0", other]);
  expect(evaluateCore(data, input)).toEqual(evaluateFlag(data, input));
});
it("evicts the older actual string and keeps only two entries as live context changes", () => {
  const data = snapshot(false, true);
  const input = request("2.1.0");
  const versions = ["2.1.0", "3.0.0", "4.0.0"];
  evaluateFlag(data, input);
  constructions.values.length = 0;
  let visited = 0;
  expect(
    evaluateWithTrace(data, input, () => {
      const next = versions[++visited % versions.length] as string;
      input.context.version = next;
      input.context.other = next;
    }).reason
  ).toBe("STATIC");
  expect(visited).toBe(100);
  expect(constructions.values).toEqual(
    Array.from({ length: 100 }, (_, index) => versions[index % 3])
  );
});
it("retains first-match short circuit behavior", () => {
  const data = snapshot(true);
  const input = request("10.0.0");
  evaluateFlag(data, input);
  constructions.values.length = 0;
  expect(evaluateFlag(data, input)).toMatchObject({ ruleId: "r0", value: true });
  expect(constructions.values).toEqual(["10.0.0"]);
});

it.each([
  ["value", "parsed"],
  ["previousValue", "previousParsed"]
] as const)("never accepts inherited %s/%s as cached version data", (valueKey, parsedKey) => {
  const data = snapshot();
  const input = request("2.1.0");
  evaluateFlag(data, input);
  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, valueKey);
  const originalParsed = Object.getOwnPropertyDescriptor(Object.prototype, parsedKey);
  try {
    Object.defineProperty(Object.prototype, valueKey, { value: "2.1.0", configurable: true });
    Object.defineProperty(Object.prototype, parsedKey, {
      value: { compare: () => 0 },
      configurable: true
    });
    const result = evaluateFlag(data, input);
    expect(result.value).toBe(false);
    expect(result.reason).toBe("STATIC");
  } finally {
    if (originalValue === undefined) Reflect.deleteProperty(Object.prototype, valueKey);
    else Object.defineProperty(Object.prototype, valueKey, originalValue);
    if (originalParsed === undefined) Reflect.deleteProperty(Object.prototype, parsedKey);
    else Object.defineProperty(Object.prototype, parsedKey, originalParsed);
  }
});
