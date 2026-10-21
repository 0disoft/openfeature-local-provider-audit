import type { ScheduledRollout, ScheduleEvaluation } from "../public-types.js";
import { computeBucket, percentageToBucketCount } from "./bucketing.js";

export const validScheduleTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const validSchedulePercentage = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100 &&
  Math.abs(value * 1000 - Math.round(value * 1000)) <= Number.EPSILON * 1000;

export function selectScheduledVariant(
  schedule: ScheduledRollout,
  flagKey: string,
  targetingKey: string,
  evaluatedAt: number
) {
  let stage: number | null = null;
  let percentage = 0;
  for (let index = 0; index < schedule.stages.length; index++) {
    const entry = schedule.stages[index];
    if (entry === undefined || entry.at > evaluatedAt) break;
    stage = index;
    percentage = entry.percentage;
  }
  const bucket = computeBucket(flagKey, targetingKey, schedule.seed);
  return {
    bucket,
    ...(bucket < percentageToBucketCount(percentage) ? { variant: schedule.variant } : {}),
    schedule: Object.freeze({ evaluatedAt, stage, percentage })
  };
}

export function captureScheduleEvaluation(value: unknown): ScheduleEvaluation {
  const invalid = () => new TypeError("Schedule decision metadata is invalid.");
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const allowed = ["evaluatedAt", "stage", "percentage"];
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw invalid();
    result[key] = descriptor.value;
  }
  if (
    !validScheduleTime(result.evaluatedAt) ||
    !validSchedulePercentage(result.percentage) ||
    (result.stage !== null &&
      (!Number.isInteger(result.stage) ||
        (result.stage as number) < 0 ||
        (result.stage as number) >= 100)) ||
    (result.stage === null && result.percentage !== 0)
  )
    throw invalid();
  return Object.freeze(result) as unknown as ScheduleEvaluation;
}
