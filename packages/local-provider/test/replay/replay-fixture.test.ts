import { describe, expect, it } from "vitest";
import { replayEvaluationFixture } from "../../src/replay/replay-fixture.js";
import type { ReplayFixture } from "../../src/public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { replayFixtures } from "./fixtures.js";

describe("replayEvaluationFixture", () => {
  it.each(["hole", "hidden accessor"])(
    "rejects a shared %s array even when an extra property masks its missing enumerable slot",
    (kind) => {
      let reads = 0;
      const value: boolean[] = Array(1);
      if (kind === "hidden accessor")
        Object.defineProperty(value, "0", {
          get() {
            reads++;
            return false;
          },
          enumerable: false
        });
      Object.defineProperty(value, "extra", { value: false, enumerable: true });
      const fixture: ReplayFixture = {
        schemaVersion: 1,
        name: kind,
        snapshot: { schemaVersion: 1, flags: {} },
        request: { flagKey: "missing", expectedType: "object", defaultValue: value },
        expected: { value, reason: "DEFAULT", source: "default", errorCode: "FLAG_NOT_FOUND" }
      };
      expect(replayEvaluationFixture(fixture)).toMatchObject({
        passed: false,
        mismatches: [{ field: "value" }]
      });
      expect(reads).toBe(0);
    }
  );

  it("does not let hidden array methods falsify a comparison", () => {
    let calls = 0;
    const value = [true];
    Object.defineProperty(value, "map", {
      get() {
        calls++;
        return () => [false];
      }
    });
    const fixture: ReplayFixture = {
      schemaVersion: 1,
      name: "array-method",
      snapshot: {
        schemaVersion: 1,
        flags: { f: { type: "object", defaultVariant: "v", variants: { v: [false] } } }
      },
      request: { flagKey: "f", expectedType: "object", defaultValue: [] },
      expected: { value, variant: "v", reason: "STATIC", source: "file" }
    };
    expect(replayEvaluationFixture(fixture)).toMatchObject({
      passed: false,
      mismatches: [{ field: "value" }]
    });
    expect(calls).toBe(0);
  });

  it("reports cyclic, excessive-depth and accessor values as mismatches without executing getters", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    let deep: unknown = 0;
    for (let index = 0; index < 12_000; index++) deep = [deep];
    let reads = 0;
    const accessor = {
      get value() {
        reads++;
        return true;
      }
    };
    const base = getReplayFixture(0);
    for (const value of [cyclic, deep, accessor, Number.NaN]) {
      const result = replayEvaluationFixture({
        ...base,
        expected: { ...base.expected, value: value as never }
      });
      expect(result.passed).toBe(false);
      expect(result.mismatches.map((entry) => entry.field)).toContain("value");
    }
    expect(reads).toBe(0);
  });

  it.each(replayFixtures)("passes replay fixture $name", (fixture) => {
    expect(replayEvaluationFixture(fixture)).toMatchObject({
      fixtureName: fixture.name,
      passed: true,
      mismatches: []
    });
  });

  it("reports field-level mismatches without throwing", () => {
    const baseFixture = getReplayFixture(0);
    const fixture: ReplayFixture = {
      ...baseFixture,
      expected: {
        ...baseFixture.expected,
        value: false
      }
    };

    expect(replayEvaluationFixture(fixture)).toMatchObject({
      fixtureName: "rollout-user-alpha-on",
      passed: false,
      mismatches: [
        {
          field: "value",
          expected: false,
          actual: true
        }
      ]
    });
  });

  it("replays JSON override input before evaluating", () => {
    const baseFixture = getReplayFixture(0);
    const fixture: ReplayFixture = {
      schemaVersion: 1,
      name: "json-override-before-rollout",
      snapshot: baseFixture.snapshot,
      overrides: {
        overridesJson: JSON.stringify({ "checkout.rollout": false })
      },
      request: {
        flagKey: "checkout.rollout",
        defaultValue: true,
        expectedType: "boolean",
        targetingKey: "user-alpha"
      },
      expected: {
        value: false,
        reason: EVALUATION_REASONS.ENV_OVERRIDE,
        source: EVALUATION_SOURCES.ENV
      }
    };

    expect(replayEvaluationFixture(fixture).passed).toBe(true);
  });

  it("compares object values independently of key insertion order", () => {
    const fixture: ReplayFixture = {
      schemaVersion: 1,
      name: "object-value-key-order",
      snapshot: {
        schemaVersion: 1,
        flags: {
          "checkout.object": {
            type: "object",
            variants: {
              configured: {
                alpha: 1,
                nested: {
                  first: true,
                  second: false
                },
                items: [
                  {
                    left: "a",
                    right: "b"
                  }
                ]
              }
            },
            defaultVariant: "configured"
          }
        }
      },
      request: {
        flagKey: "checkout.object",
        defaultValue: {},
        expectedType: "object"
      },
      expected: {
        value: {
          items: [
            {
              right: "b",
              left: "a"
            }
          ],
          nested: {
            second: false,
            first: true
          },
          alpha: 1
        },
        variant: "configured",
        reason: EVALUATION_REASONS.STATIC,
        source: EVALUATION_SOURCES.FILE
      }
    };

    expect(replayEvaluationFixture(fixture)).toMatchObject({
      passed: true,
      mismatches: []
    });
  });

  it("keeps array order significant for replay object values", () => {
    const fixture: ReplayFixture = {
      schemaVersion: 1,
      name: "object-value-array-order",
      snapshot: {
        schemaVersion: 1,
        flags: {
          "checkout.object": {
            type: "object",
            variants: {
              configured: {
                items: ["first", "second"]
              }
            },
            defaultVariant: "configured"
          }
        }
      },
      request: {
        flagKey: "checkout.object",
        defaultValue: {},
        expectedType: "object"
      },
      expected: {
        value: {
          items: ["second", "first"]
        },
        variant: "configured",
        reason: EVALUATION_REASONS.STATIC,
        source: EVALUATION_SOURCES.FILE
      }
    };

    expect(replayEvaluationFixture(fixture)).toMatchObject({
      passed: false,
      mismatches: [
        {
          field: "value"
        }
      ]
    });
  });
});

function getReplayFixture(index: number): ReplayFixture {
  const fixture = replayFixtures[index];
  if (fixture === undefined) {
    throw new Error(`Expected replay fixture at index ${index}.`);
  }

  return fixture;
}
