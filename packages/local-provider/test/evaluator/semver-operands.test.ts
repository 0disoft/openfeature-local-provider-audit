import { expect, it, vi } from "vitest";
import { matchesCondition } from "../../src/evaluator/conditions.js";
import { evaluateFlag, parseJsonFlagSnapshot } from "../../src/index.js";

const constructed = vi.hoisted(() => vi.fn());
vi.mock("semver", async (original) => {
  const actual = await original<typeof import("semver")>();
  return {
    ...actual,
    SemVer: class extends actual.SemVer {
      constructor(...args: ConstructorParameters<typeof actual.SemVer>) {
        super(...args);
        constructed(...args);
      }
    }
  };
});
const request = (version: string) => ({
  flagKey: "f",
  expectedType: "boolean" as const,
  defaultValue: false,
  context: { version }
});

it("parses one fixed operand once while checking each live context version", () => {
  const snapshot = parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion: 2,
      flags: {
        f: {
          type: "boolean",
          defaultVariant: "off",
          variants: { off: false, on: true },
          rules: [
            {
              id: "version",
              variant: "on",
              when: {
                attribute: ["version"],
                op: "semverGte",
                value: "2.0.0"
              }
            }
          ]
        }
      }
    })
  );
  constructed.mockClear();
  for (let index = 0; index < 10; index++) {
    const enabled = index % 2 === 0;
    expect(evaluateFlag(snapshot, request(enabled ? "2.1.0" : "1.9.0")).value).toBe(enabled);
  }
  expect(constructed).toHaveBeenCalledTimes(11);
});

it("refreshes caller-owned operands after valid, invalid and restored values", () => {
  const condition = { attribute: ["version"], op: "semverGte" as const, value: "2.0.0" };
  expect(matchesCondition(condition, request("2.1.0"))).toBe(true);
  condition.value = "3.0.0";
  expect(matchesCondition(condition, request("2.1.0"))).toBe(false);
  condition.value = "bad";
  expect(matchesCondition(condition, request("2.1.0"))).toBe(false);
  expect(matchesCondition(condition, request("2.1.0"))).toBe(false);
  condition.value = "2.0.0";
  expect(matchesCondition(condition, request("2.1.0"))).toBe(true);
});

it("reads an accessor operand once on every evaluation", () => {
  const value = vi.fn().mockReturnValueOnce("2.0.0").mockReturnValueOnce("3.0.0");
  const condition = {
    attribute: ["version"],
    op: "semverGte" as const,
    get value(): string {
      return value();
    }
  };
  expect(matchesCondition(condition, request("2.1.0"))).toBe(true);
  expect(matchesCondition(condition, request("2.1.0"))).toBe(false);
  expect(value).toHaveBeenCalledTimes(2);
});
