import { createEnvOverrides } from "../env/env-overrides.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import { isJsonValue } from "../evaluator/type-guards.js";
import type {
  EvaluationRequest,
  EvaluationResult,
  FlagValue,
  JsonValue,
  ReplayExpectedResult,
  ReplayFixture,
  ReplayMismatch,
  ReplayResult
} from "../public-types.js";

const REPLAY_FIELDS = [
  "schedule",
  "value",
  "variant",
  "ruleId",
  "bucket",
  "reason",
  "source",
  "errorCode"
] as const;

export function replayEvaluationFixture<T extends FlagValue>(
  fixture: ReplayFixture<T>
): ReplayResult<T> {
  const request = createReplayRequest(fixture);
  const actual = toReplayExpectedResult(evaluateFlag(fixture.snapshot, request));
  const mismatches = collectMismatches(fixture.expected, actual);

  return {
    fixtureName: fixture.name,
    passed: mismatches.length === 0,
    expected: fixture.expected,
    actual,
    mismatches
  };
}

function createReplayRequest<T extends FlagValue>(fixture: ReplayFixture<T>): EvaluationRequest<T> {
  if (fixture.overrides === undefined) {
    return fixture.request;
  }

  const overrideOptions =
    fixture.overrides.overridesJson === undefined
      ? { env: fixture.overrides.env ?? {} }
      : {
          overridesJson: fixture.overrides.overridesJson,
          env: fixture.overrides.env ?? {}
        };

  return {
    ...fixture.request,
    overrides: createEnvOverrides(fixture.snapshot, overrideOptions)
  };
}

function toReplayExpectedResult<T extends FlagValue>(
  result: EvaluationResult<T>
): ReplayExpectedResult<T> {
  return {
    value: result.value,
    ...(result.schedule !== undefined ? { schedule: result.schedule } : {}),
    reason: result.reason,
    source: result.source,
    ...(result.variant !== undefined ? { variant: result.variant } : {}),
    ...(result.ruleId !== undefined ? { ruleId: result.ruleId } : {}),
    ...(result.bucket !== undefined ? { bucket: result.bucket } : {}),
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {})
  };
}

function collectMismatches<T extends FlagValue>(
  expected: ReplayExpectedResult<T>,
  actual: ReplayExpectedResult<T>
): readonly ReplayMismatch[] {
  const mismatches: ReplayMismatch[] = [];

  for (const field of REPLAY_FIELDS) {
    if (
      !jsonValuesEqual(
        expected[field] as JsonValue | undefined,
        actual[field] as JsonValue | undefined
      )
    ) {
      mismatches.push({
        field,
        expected: expected[field] as JsonValue | undefined,
        actual: actual[field] as JsonValue | undefined
      });
    }
  }

  return mismatches;
}

function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (!isJsonValue(left) || !isJsonValue(right)) return false;
  const pending: [JsonValue, JsonValue][] = [[left, right]];
  let visited = 0;
  try {
    while (pending.length > 0) {
      if (++visited > 100_000) return false;
      const pair = pending.pop();
      if (pair === undefined) break;
      const [expected, actual] = pair;
      if (expected === actual) continue;
      if (
        expected === null ||
        actual === null ||
        typeof expected !== "object" ||
        typeof actual !== "object"
      )
        return false;
      const array = Array.isArray(expected);
      if (array !== Array.isArray(actual)) return false;
      const keys = array
        ? Array.from({ length: expected.length }, (_, index) => String(index))
        : Object.keys(expected);
      if (
        array
          ? expected.length !== (actual as readonly JsonValue[]).length
          : keys.length !== Object.keys(actual).length
      )
        return false;
      for (const key of keys) {
        const a = Object.getOwnPropertyDescriptor(expected, key);
        const b = Object.getOwnPropertyDescriptor(actual, key);
        if (!a || !b || !("value" in a) || !("value" in b)) return false;
        pending.push([a.value, b.value]);
      }
    }
    return true;
  } catch {
    return false;
  }
}
