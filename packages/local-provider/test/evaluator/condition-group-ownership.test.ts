import { expect, it, vi } from "vitest";
import { evaluateFlag, evaluateWithTrace } from "../../src/evaluator/evaluate.js";
import { evaluateFlag as evaluateCore } from "../../src/core.js";
import { createSnapshotHash } from "../../src/audit/audit-event.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";
import { createReloadableLocalProvider } from "../../src/provider/local-provider.js";
import type { TargetingCondition } from "../../src/core-types.js";

const leaf = { attribute: ["tenant"], op: "eq", value: "pilot" } as const;
function snapshot(when: TargetingCondition = leaf) {
  return validateFlagSnapshot({
    schemaVersion: 2,
    flags: {
      f: {
        type: "boolean",
        defaultVariant: "off",
        variants: { on: true, off: false },
        rules: [{ id: "pilot-only", when, variant: "on" }]
      }
    }
  });
}
const request = (tenant: string) => ({
  flagKey: "f",
  expectedType: "boolean" as const,
  defaultValue: true,
  context: { tenant }
});
function inherited<T>(key: string, descriptor: PropertyDescriptor, run: () => T): T {
  const before = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    Object.defineProperty(Object.prototype, key, { ...descriptor, configurable: true });
    return run();
  } finally {
    if (before === undefined) Reflect.deleteProperty(Object.prototype, key);
    else Object.defineProperty(Object.prototype, key, before);
  }
}

it.each(["all", "any"])(
  "ignores inherited %s arrays for validated leaves and nested groups",
  (key) => {
    for (const when of [leaf, { all: [leaf] }, { any: [leaf] }, { all: [{ any: [leaf] }] }]) {
      const data = snapshot(when);
      const hash = createSnapshotHash(data);
      for (const tenant of ["pilot", "other"]) {
        const input = request(tenant);
        const expected = evaluateFlag(data, input);
        const baselineTrace: [string, boolean][] = [];
        evaluateWithTrace(data, input, (id, matched) => baselineTrace.push([id, matched]));
        const actual = inherited(key, { value: [], writable: true }, () => {
          const trace: [string, boolean][] = [];
          const result = evaluateWithTrace(data, input, (id, matched) => trace.push([id, matched]));
          return { result, trace, core: evaluateCore(data, input), hash: createSnapshotHash(data) };
        });
        expect(actual).toEqual({ result: expected, trace: baselineTrace, core: expected, hash });
      }
    }
  }
);

it.each(["all", "any"])("never invokes an inherited %s getter during evaluation", (key) => {
  const data = snapshot({ any: [{ all: [leaf] }] });
  const getter = vi.fn(() => {
    throw new Error("Inherited group accessor must not run");
  });
  const result = inherited(key, { get: getter }, () => evaluateFlag(data, request("other")));
  expect(result).toMatchObject({ value: false, reason: "STATIC" });
  expect(getter).not.toHaveBeenCalled();
});

it("keeps real group short circuiting without reading the skipped context accessor", () => {
  const data = snapshot({ any: [leaf, { attribute: ["skipped"], op: "eq", value: true }] });
  const input = request("pilot");
  const getter = vi.fn(() => {
    throw new Error("Must remain short circuited");
  });
  Object.defineProperty(input.context, "skipped", { get: getter, enumerable: true });
  const result = inherited("all", { value: [], writable: true }, () => evaluateFlag(data, input));
  expect(result).toMatchObject({ value: true, reason: "TARGETING_MATCH", ruleId: "pilot-only" });
  expect(getter).not.toHaveBeenCalled();
});

it("preserves native provider results and audit reasons without changing snapshot identity", async () => {
  const events: { reason: string; snapshotHash: string }[] = [];
  const provider = createReloadableLocalProvider({
    snapshot: snapshot(),
    env: {},
    auditSink: {
      async write(event) {
        events.push(event);
      }
    }
  });
  const hash = provider.getStatus().snapshotHash;
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const resolution = inherited("all", { value: [], writable: true }, () =>
    provider.resolveBooleanEvaluation("f", true, { tenant: "other" }, logger)
  );
  await expect(resolution).resolves.toMatchObject({
    value: false,
    reason: "STATIC",
    variant: "off"
  });
  expect(events).toMatchObject([{ reason: "STATIC", snapshotHash: hash }]);
  expect(provider.getStatus().snapshotHash).toBe(hash);
  await provider.onClose?.();
});
