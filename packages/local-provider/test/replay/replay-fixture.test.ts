import { describe, expect, it } from "vitest";
import { replayEvaluationFixture } from "../../src/replay/replay-fixture.js";
import type { ReplayFixture } from "../../src/public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { replayFixtures } from "./fixtures.js";

describe("replayEvaluationFixture", () => {
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
