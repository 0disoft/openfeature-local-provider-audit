import { createEnvOverrides } from "../env/env-overrides.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
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

const REPLAY_FIELDS = ["value", "variant", "bucket", "reason", "source", "errorCode"] as const;

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
    reason: result.reason,
    source: result.source,
    ...(result.variant !== undefined ? { variant: result.variant } : {}),
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
    if (!jsonValuesEqual(expected[field], actual[field])) {
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
  return JSON.stringify(left) === JSON.stringify(right);
}
