import { describe, expect, it, vi } from "vitest";
import {
  createAuditEvent,
  createLocalProvider,
  evaluateFlag,
  explainEvaluation,
  parseJsonFlagSnapshot,
  redactContext,
  replayEvaluationFixture
} from "../../src/index.js";
import type { AuditEvent } from "../../src/index.js";

const snapshot = parseJsonFlagSnapshot(
  JSON.stringify({
    schemaVersion: 2,
    flags: {
      options: {
        type: "object",
        variants: { control: { secret: "evaluated-secret" }, pilot: { secret: "other-secret" } },
        defaultVariant: "control",
        rules: [
          { id: "first", when: { attribute: ["plan"], op: "eq", value: "pro" }, variant: "pilot" },
          {
            id: "second",
            when: { attribute: ["plan"], op: "eq", value: "free" },
            variant: "control"
          },
          {
            id: "never-visited",
            when: { attribute: ["plan"], op: "eq", value: "free" },
            variant: "pilot"
          }
        ]
      }
    }
  })
);
const request = {
  flagKey: "options",
  expectedType: "object" as const,
  defaultValue: {},
  targetingKey: "private-id",
  context: { plan: "free", email: "private@example.test" }
};

describe("redacted explanations and rule replay", () => {
  it("uses the selection engine and exposes only visited rule outcomes", () => {
    const result = evaluateFlag(snapshot, request);
    const explanation = explainEvaluation(snapshot, request);
    expect(explanation).toMatchObject({
      reason: result.reason,
      source: result.source,
      variant: result.variant,
      ruleId: "second",
      rules: [
        { ruleId: "first", matched: false },
        { ruleId: "second", matched: true }
      ]
    });
    expect(explanation.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    const json = JSON.stringify(explanation);
    for (const secret of [
      "private-id",
      "private@example.test",
      "evaluated-secret",
      "other-secret",
      '"plan"',
      '"value"',
      '"context"'
    ])
      expect(json).not.toContain(secret);
  });

  it("shows override, missing flag and rollout failure without raw values", () => {
    const overridden = explainEvaluation(snapshot, {
      ...request,
      overrides: { values: { options: { secret: "override-secret" } }, errors: {} }
    });
    expect(overridden).toMatchObject({ reason: "ENV_OVERRIDE", rules: [] });
    expect(overridden.overrideHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(overridden)).not.toContain("override-secret");
    expect(explainEvaluation(snapshot, { ...request, flagKey: "missing" })).toMatchObject({
      errorCode: "FLAG_NOT_FOUND",
      rules: []
    });
    const split = parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          split: {
            type: "boolean",
            defaultVariant: "on",
            variants: { on: true },
            rules: [
              {
                id: "split",
                when: { attribute: ["plan"], op: "eq", value: "free" },
                rollout: [{ variant: "on", percentage: 100 }]
              }
            ]
          }
        }
      })
    );
    expect(
      explainEvaluation(split, {
        flagKey: "split",
        defaultValue: false,
        expectedType: "boolean",
        context: request.context
      })
    ).toMatchObject({ ruleId: "split", errorCode: "INVALID_CONTEXT" });
    expect(
      explainEvaluation(split, {
        flagKey: "split",
        defaultValue: false,
        expectedType: "boolean",
        context: request.context,
        targetingKey: "synthetic"
      }).bucket
    ).toBeTypeOf("number");
  });

  it("records selected rule identity in audit and detects replay drift", async () => {
    const events: AuditEvent[] = [];
    const provider = createLocalProvider({
      snapshot,
      env: {},
      auditWriteMode: "blocking",
      auditSink: {
        async write(event) {
          events.push(event);
        }
      }
    });
    await provider.resolveObjectEvaluation("options", {}, request.context, {
      warn: vi.fn()
    } as never);
    expect(events[0]?.ruleId).toBe("second");
    expect(JSON.stringify(events)).not.toContain("private@example.test");
    const fixture = {
      schemaVersion: 1 as const,
      name: "targeting",
      snapshot,
      request,
      expected: {
        value: { secret: "evaluated-secret" },
        variant: "control",
        ruleId: "second",
        reason: "TARGETING_MATCH" as const,
        source: "file" as const
      }
    };
    expect(replayEvaluationFixture(fixture).passed).toBe(true);
    expect(
      replayEvaluationFixture({ ...fixture, expected: { ...fixture.expected, ruleId: "wrong" } })
        .mismatches
    ).toContainEqual({ field: "ruleId", expected: "wrong", actual: "second" });
    await provider.onClose?.();
  });

  it("never reads context getters to create audit or presence metadata", () => {
    const getter = vi.fn(() => {
      throw new Error("do not evaluate context accessors");
    });
    const context = Object.defineProperties(
      {},
      {
        private: { enumerable: true, get: getter },
        targetingKey: { enumerable: true, get: getter }
      }
    );
    const event = createAuditEvent({
      providerName: "synthetic",
      snapshot,
      request: { ...request, context },
      result: evaluateFlag(snapshot, request)
    });
    expect(event.context).toMatchObject({ targetingKeyPresent: true, keyCount: 2 });
    expect(redactContext(context).targetingKeyPresent).toBe(false);
    const names = createAuditEvent({
      providerName: "synthetic",
      snapshot,
      request,
      result: evaluateFlag(snapshot, request),
      redaction: { contextKeys: "names" }
    }).context.keys;
    expect(names).toEqual(["email", "plan", "targetingKey"]);
    expect(getter).not.toHaveBeenCalled();
  });
});
