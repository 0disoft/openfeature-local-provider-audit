import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalProvider,
  createReloadableLocalProvider,
  createChainedFileAuditSink,
  createAuditEvent,
  createAuditChainCheckpoint,
  createChainedAuditEvent,
  evaluateFlag,
  explainEvaluation,
  parseJsonFlagSnapshot,
  parseYamlFlagSnapshot,
  replayEvaluationFixture,
  verifyAuditChain,
  type FlagSnapshot,
  type ScheduledRollout,
  type ScheduleEvaluation,
  type ChainedAuditEvent
} from "../../src/index.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";
import { runCli } from "../../src/cli/run.js";

const schedule: ScheduledRollout = {
  variant: "on",
  seed: "stable",
  stages: [
    { at: 1000, percentage: 10 },
    { at: 2000, percentage: 50 },
    { at: 3000, percentage: 100 }
  ]
};
function snapshot(extra = {}, version: 1 | 2 = 2): FlagSnapshot {
  return validateFlagSnapshot({
    schemaVersion: version,
    flags: {
      feature: Object.fromEntries(
        Object.entries({
          type: "boolean",
          variants: { on: true, off: false },
          defaultVariant: "off",
          schedule,
          ...extra
        }).filter(([, value]) => value !== undefined)
      )
    }
  });
}
function request(evaluationTime?: number, targetingKey = "subject") {
  return {
    flagKey: "feature",
    expectedType: "boolean" as const,
    defaultValue: false,
    targetingKey,
    ...(evaluationTime !== undefined ? { evaluationTime } : {})
  };
}
const logger = { warn() {}, debug() {}, info() {}, error() {} };
afterEach(() => vi.restoreAllMocks());

describe("scheduled local rollout", () => {
  it("selects exact time boundaries, final stage and backward time without ambient clock reads", () => {
    const input = snapshot();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("ambient clock");
    });
    for (const [at, stage, percentage] of [
      [999, null, 0],
      [1000, 0, 10],
      [1999, 0, 10],
      [2000, 1, 50],
      [3000, 2, 100],
      [9000, 2, 100],
      [500, null, 0]
    ] as const) {
      const result = evaluateFlag(input, request(at));
      expect(result.schedule).toEqual({ evaluatedAt: at, stage, percentage });
      expect(result.value).toBe(
        at >= 3000 || (at >= 1000 && (result.bucket ?? 100000) < percentage * 1000)
      );
    }
    expect(clock).not.toHaveBeenCalled();
    for (const at of [undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(evaluateFlag(input, request(at))).toMatchObject({
        value: false,
        errorCode: "INVALID_CONTEXT"
      });
    expect(evaluateFlag(input, request(3000, " "))).toMatchObject({ errorCode: "INVALID_CONTEXT" });
  });

  it("expands nonempty deterministic cohorts and matches existing seeded rollout buckets", () => {
    const input = snapshot();
    const cohorts = [new Set<number>(), new Set<number>(), new Set<number>()];
    for (let index = 0; index < 200; index++) {
      const key = `subject-${index}`;
      for (const [stage, at] of [1000, 2000, 3000].entries()) {
        const result = evaluateFlag(input, request(at, key));
        const legacy = evaluateFlag(
          snapshot({
            schedule: undefined,
            rollout: [{ variant: "on", percentage: [10, 50, 100][stage], seed: "stable" }]
          }),
          request(undefined, key)
        );
        const reference = evaluateFlag(
          snapshot({
            schedule: undefined,
            rollout: [{ variant: "on", percentage: 100, seed: "stable" }]
          }),
          request(undefined, key)
        );
        expect(result.bucket).toBe(reference.bucket);
        expect(result.value).toBe(legacy.value);
        if (result.value) cohorts[stage]?.add(index);
      }
    }
    expect(cohorts[0]?.size).toBeGreaterThan(0);
    expect(cohorts[1]?.size).toBeGreaterThan(cohorts[0]?.size ?? 0);
    expect(cohorts[2]?.size).toBe(200);
    for (const value of cohorts[0] ?? []) expect(cohorts[1]?.has(value)).toBe(true);
    for (const value of cohorts[1] ?? []) expect(cohorts[2]?.has(value)).toBe(true);
    expect(
      evaluateFlag(snapshot({ schedule: { ...schedule, seed: undefined } }), request(2000)).bucket
    ).toBe(
      evaluateFlag(
        snapshot({ schedule: undefined, rollout: [{ variant: "on", percentage: 100 }] }),
        request()
      ).bucket
    );
  });

  it("keeps emergency/override/first-match priority and leaves unscheduled v1/v2 unchanged", async () => {
    const bad = { ...request(), overrides: { values: {}, errors: { feature: "bad override" } } };
    expect(evaluateFlag(snapshot({ disabledVariant: "off" }), bad)).toMatchObject({
      value: false,
      reason: "DISABLED"
    });
    expect(evaluateFlag(snapshot(), bad)).toMatchObject({ errorCode: "OVERRIDE_PARSE_ERROR" });
    expect(
      evaluateFlag(snapshot(), {
        ...request(),
        overrides: { values: { feature: true }, errors: {} }
      })
    ).toMatchObject({ value: true, reason: "ENV_OVERRIDE" });
    const rules = [
      { id: "internal", when: { attribute: ["internal"], op: "eq", value: true }, variant: "on" }
    ];
    expect(
      evaluateFlag(snapshot({ rules }), { ...request(), context: { internal: true } })
    ).toMatchObject({ value: true, ruleId: "internal", reason: "TARGETING_MATCH" });
    const clock = vi.fn(() => {
      throw new Error("unused");
    });
    for (const version of [1, 2] as const) {
      const provider = createLocalProvider({
        snapshot: snapshot({ schedule: undefined }, version),
        env: {},
        clock
      });
      expect(await provider.resolveBooleanEvaluation("feature", true, {}, logger)).toMatchObject({
        value: false,
        reason: "STATIC"
      });
      await provider.onClose?.();
    }
    expect(clock).not.toHaveBeenCalled();
    expect(() =>
      createLocalProvider({ snapshot: snapshot(), clock: 1 as unknown as () => number })
    ).toThrow("clock");
    for (const clock of [
      () => NaN,
      () => {
        throw new Error("private clock");
      }
    ]) {
      const provider = createLocalProvider({ snapshot: snapshot(), env: {}, clock });
      expect(
        await provider.resolveBooleanEvaluation(
          "feature",
          false,
          { targetingKey: "subject", evaluationTime: 3000 },
          logger
        )
      ).toMatchObject({ errorCode: "INVALID_CONTEXT" });
      await provider.onClose?.();
    }
  });

  it("rejects malformed/bounded schedules and captures immutable configuration without getters", () => {
    for (const invalid of [
      null,
      [],
      { ...schedule, variant: "unknown" },
      { ...schedule, seed: "" },
      { ...schedule, seed: "x".repeat(129) },
      { ...schedule, extra: true },
      { ...schedule, stages: [] },
      { ...schedule, stages: Array(101).fill({ at: 1, percentage: 1 }) },
      { ...schedule, stages: [{ at: -1, percentage: 1 }] },
      { ...schedule, stages: [{ at: 1.5, percentage: 1 }] },
      { ...schedule, stages: [{ at: 1, percentage: 100.001 }] },
      { ...schedule, stages: [{ at: 1, percentage: 0.0001 }] },
      {
        ...schedule,
        stages: [
          { at: 2, percentage: 1 },
          { at: 2, percentage: 2 }
        ]
      },
      {
        ...schedule,
        stages: [
          { at: 2, percentage: 50 },
          { at: 3, percentage: 10 }
        ]
      },
      { ...schedule, stages: [{ at: 2, percentage: 1, extra: true }] }
    ])
      expect(() => snapshot({ schedule: invalid })).toThrow();
    expect(() => snapshot({}, 1)).toThrow();
    expect(() => snapshot({ rollout: [{ variant: "on", percentage: 1 }] })).toThrow(
      "mutually exclusive"
    );
    const getter = vi.fn(() => 10),
      entry = { at: 1 };
    Object.defineProperty(entry, "percentage", { enumerable: true, get: getter });
    expect(() => snapshot({ schedule: { ...schedule, stages: [entry] } })).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const mutable = {
      variant: "on",
      stages: [
        { at: 0, percentage: 0 },
        { at: 1, percentage: 0.001 }
      ]
    };
    const input = snapshot({ schedule: mutable });
    const firstStage = mutable.stages[0];
    if (firstStage === undefined) throw new Error("Missing mutable stage");
    firstStage.percentage = 100;
    expect(input.flags.feature?.schedule?.stages[0]?.percentage).toBe(0);
    expect(Object.isFrozen(input.flags.feature?.schedule?.stages)).toBe(true);
    expect(parseJsonFlagSnapshot(JSON.stringify(input))).toEqual(input);
    expect(
      parseYamlFlagSnapshot(
        "schemaVersion: 2\nflags:\n  feature:\n    type: boolean\n    variants: {on: true, off: false}\n    defaultVariant: off\n    schedule:\n      variant: on\n      stages: [{at: 0, percentage: 100}]\n"
      ).flags.feature?.schedule?.stages[0]?.percentage
    ).toBe(100);
  });

  it("reproduces schedule decisions in explanations/replay and rejects invalid chain metadata", () => {
    const input = snapshot(),
      req = request(2000),
      result = evaluateFlag(input, req);
    const { flagMetadata: _, flagKey: __, ...expected } = result;
    const fixture = {
      schemaVersion: 1 as const,
      name: "schedule",
      snapshot: input,
      request: req,
      expected
    };
    expect(explainEvaluation(input, req).schedule).toEqual(result.schedule);
    expect(replayEvaluationFixture(fixture).passed).toBe(true);
    expect(
      replayEvaluationFixture({ ...fixture, request: request(3000) }).mismatches.some(
        (mismatch) => mismatch.field === "schedule"
      )
    ).toBe(true);
    const event = createAuditEvent({ providerName: "test", snapshot: input, request: req, result }),
      anchor = createAuditChainCheckpoint("test");
    const record = createChainedAuditEvent(event, anchor);
    expect(verifyAuditChain([record], { start: anchor }).records).toBe(1);
    for (const invalid of [
      null,
      { ...result.schedule, stage: 100 },
      { ...result.schedule, stage: null },
      { ...result.schedule, evaluatedAt: -1 },
      { ...result.schedule, percentage: -1 },
      { ...result.schedule, raw: "private" }
    ])
      expect(() =>
        createChainedAuditEvent({ ...event, schedule: invalid as ScheduleEvaluation }, anchor)
      ).toThrow();
  });

  it("uses one trusted SDK clock read and writes verifiable schedule audit; CLI simulates fixed times", async () => {
    const directory = await mkdtemp(join(tmpdir(), "of-schedule-"));
    const input = snapshot(),
      clock = vi.fn(() => 3000),
      sink = createChainedFileAuditSink({ directory: join(directory, "audit"), chainId: "test" });
    const provider = createReloadableLocalProvider({
      snapshot: input,
      env: {},
      clock,
      auditSink: sink,
      auditWriteMode: "blocking"
    });
    try {
      await OpenFeature.setProviderAndWait("scheduled", provider);
      expect(
        await OpenFeature.getClient("scheduled").getBooleanValue("feature", false, {
          targetingKey: "private",
          evaluationTime: 0
        })
      ).toBe(true);
      expect(clock).toHaveBeenCalledOnce();
      const checkpoint = await sink.getCheckpoint();
      const record = JSON.parse(
        (await readFile(join(directory, "audit", checkpoint.files[0] ?? ""), "utf8")).trim()
      ) as ChainedAuditEvent;
      expect(record.event.schedule).toEqual({ evaluatedAt: 3000, stage: 2, percentage: 100 });
      expect(JSON.stringify(record)).not.toContain("private");
      expect(
        verifyAuditChain([record], { start: checkpoint.start, expectedHead: checkpoint.head })
          .checkpointMatched
      ).toBe(true);
      await writeFile(join(directory, "flags.json"), JSON.stringify(input));
      await writeFile(
        join(directory, "requests.json"),
        JSON.stringify([request(999), request(3000)])
      );
      let stdout = "";
      const stderr = vi.fn();
      const io = {
        cwd: directory,
        stdout(text: string) {
          stdout += text;
        },
        stderr
      };
      expect(await runCli(["simulate", "flags.json", "--requests", "requests.json"], io)).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        total: 2,
        errors: 0,
        groups: [
          { reason: "STATIC", variant: "off", count: 1 },
          { reason: "SPLIT", variant: "on", count: 1 }
        ]
      });
      expect(stdout).not.toContain("subject");
      await writeFile(join(directory, "request.json"), JSON.stringify(request(3000)));
      stdout = "";
      expect(await runCli(["explain", "flags.json", "--request", "request.json"], io)).toBe(0);
      expect(JSON.parse(stdout).schedule).toEqual(record.event.schedule);
      expect(stderr).not.toHaveBeenCalled();
      await writeFile(
        join(directory, "after.json"),
        JSON.stringify(
          snapshot({
            schedule: { variant: "on", seed: "stable", stages: [{ at: 2000, percentage: 100 }] }
          })
        )
      );
      stdout = "";
      expect(
        await runCli(["compare", "flags.json", "after.json", "--requests", "requests.json"], io)
      ).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ changedValues: 0, changedDecisions: 1 });
      const now = vi.spyOn(Date, "now").mockReturnValue(3000);
      const defaultClock = createLocalProvider({ snapshot: input, env: {} });
      expect(
        await defaultClock.resolveBooleanEvaluation(
          "feature",
          false,
          { targetingKey: "subject" },
          logger
        )
      ).toMatchObject({ value: true });
      await defaultClock.onClose?.();
      now.mockRestore();
    } finally {
      await OpenFeature.clearProviders();
      expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-schedule-"))).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
