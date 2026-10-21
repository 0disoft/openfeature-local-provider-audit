import { expect, it } from "vitest";
import {
  parseJsonFlagSnapshot,
  evaluateFlag,
  createAuditEvent,
  serializeAuditEvent
} from "../../src/index.js";

function snapshots(percentage: number) {
  const rollout = [{ variant: "on", percentage }];
  const flag = { type: "boolean", variants: { on: true, off: false }, defaultVariant: "off" };
  return [
    { schemaVersion: 1, flags: { f: { ...flag, rollout } } },
    {
      schemaVersion: 2,
      flags: {
        f: {
          ...flag,
          rules: [{ id: "region", when: { attribute: ["region"], op: "eq", value: "kr" }, rollout }]
        }
      }
    },
    {
      schemaVersion: 2,
      flags: { f: { ...flag, schedule: { variant: "on", stages: [{ at: 0, percentage }] } } }
    }
  ];
}

it.each([0.001, 1, 2.01, 29.586, 65.005, 99.999, 100])(
  "accepts %s without changing stored percentages, bucket thresholds or audit metadata",
  (percentage) => {
    for (const input of snapshots(percentage)) {
      const snapshot = parseJsonFlagSnapshot(JSON.stringify(input));
      const flag = snapshot.flags.f;
      expect(
        flag?.rollout?.[0]?.percentage ??
          flag?.rules?.[0]?.rollout?.[0]?.percentage ??
          flag?.schedule?.stages[0]?.percentage
      ).toBe(percentage);
      const request = {
        flagKey: "f",
        expectedType: "boolean" as const,
        defaultValue: false,
        targetingKey: "subject",
        context: { region: "kr" },
        evaluationTime: 0
      };
      const result = evaluateFlag(snapshot, request);
      expect(result.errorCode).toBeUndefined();
      if (flag?.schedule) expect(result.schedule?.percentage).toBe(percentage);
      expect(() =>
        serializeAuditEvent(
          createAuditEvent({ providerName: "precision", snapshot, request, result })
        )
      ).not.toThrow();
    }
  }
);

it.each([0.0001, 2.0101, 65.0051, 99.9999, 100.0001])(
  "rejects excess precision %s in every rollout form",
  (percentage) => {
    for (const input of snapshots(percentage)) {
      expect(() => parseJsonFlagSnapshot(JSON.stringify(input))).toThrow(
        expect.objectContaining({ code: "SCHEMA_ERROR" })
      );
    }
  }
);
