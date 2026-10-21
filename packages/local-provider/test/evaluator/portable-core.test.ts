import { expect, it } from "vitest";
import * as core from "../../src/core.js";
import {
  evaluateFlag,
  parseJsonFlagSnapshot,
  type EvaluationRequest,
  type FlagSnapshot
} from "../../src/index.js";

it("matches native evaluation across Unicode, seeds, targeting, schedules and overrides", () => {
  const subjects = ["ascii", "한국어", "😀", "e\u0301", "a\nb", "\ud800", "\udfff", ""];
  const seeds = [undefined, "custom", "한국어😀", "\ud800"];
  for (const seed of seeds) {
    const snapshot = parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          rollout: {
            type: "boolean",
            defaultVariant: "off",
            variants: { on: true, off: false },
            rollout: [{ variant: "on", percentage: 50, ...(seed !== undefined ? { seed } : {}) }]
          },
          target: {
            type: "boolean",
            defaultVariant: "off",
            variants: { on: true, off: false },
            rules: [
              {
                id: "version",
                when: { attribute: ["version"], op: "semverGte", value: "2.0.0" },
                rollout: [
                  { variant: "on", percentage: 37.123, ...(seed !== undefined ? { seed } : {}) }
                ]
              }
            ]
          },
          schedule: {
            type: "boolean",
            defaultVariant: "off",
            variants: { on: true, off: false },
            schedule: {
              variant: "on",
              ...(seed !== undefined ? { seed } : {}),
              stages: [
                { at: 10, percentage: 25 },
                { at: 20, percentage: 100 }
              ]
            }
          }
        }
      })
    );
    const portable = core.parseJsonFlagSnapshot(JSON.stringify(snapshot));
    expect(portable).toEqual(snapshot);
    expect(Object.isFrozen(portable.flags)).toBe(true);
    for (const subject of subjects)
      for (let index = 0; index < 32; index++)
        for (const flagKey of ["rollout", "target", "schedule", "missing"]) {
          const request: EvaluationRequest<boolean> = {
            flagKey,
            expectedType: "boolean",
            defaultValue: false,
            targetingKey: `${subject}${index}`,
            context: { version: index % 2 ? "2.0.0" : "1.0.0" },
            evaluationTime: index
          };
          expect(core.evaluateFlag(portable, request)).toEqual(evaluateFlag(snapshot, request));
          if (index === 0)
            expect(
              core.evaluateFlag(portable, {
                ...request,
                overrides: { values: { [flagKey]: true }, errors: {} }
              })
            ).toEqual(
              evaluateFlag(snapshot, {
                ...request,
                overrides: { values: { [flagKey]: true }, errors: {} }
              })
            );
        }
  }
});

it("retains v1 errors, type semantics and the exact deliberate runtime surface", () => {
  const snapshot: FlagSnapshot = core.parseJsonFlagSnapshot(
    '{"schemaVersion":1,"flags":{"number":{"type":"number","defaultVariant":"one","variants":{"one":1}}}}'
  );
  expect(
    core.evaluateFlag(snapshot, { flagKey: "number", expectedType: "boolean", defaultValue: false })
  ).toEqual(
    evaluateFlag(snapshot, { flagKey: "number", expectedType: "boolean", defaultValue: false })
  );
  expect(() => core.parseJsonFlagSnapshot("invalid")).toThrow(core.LocalProviderError);
  try {
    core.parseJsonFlagSnapshot("{}");
  } catch (error) {
    expect(core.isLocalProviderError(error)).toBe(true);
  }
  expect(Object.keys(core).sort()).toEqual(
    [
      "EVALUATION_REASONS",
      "EVALUATION_SOURCES",
      "LOCAL_PROVIDER_ERROR_CODES",
      "LocalProviderError",
      "evaluateFlag",
      "isLocalProviderError",
      "parseJsonFlagSnapshot"
    ].sort()
  );
});
