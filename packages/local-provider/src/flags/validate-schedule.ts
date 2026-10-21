import { LocalProviderError } from "../errors/local-provider-error.js";
import { validScheduleTime, validSchedulePercentage } from "../evaluator/schedule.js";
import type { ScheduledRollout } from "../core-types.js";

export function validateScheduledRollout(
  input: unknown,
  hasVariant: (name: string) => boolean
): ScheduledRollout | undefined {
  if (input === undefined) return undefined;
  const value = record(input, ["variant", "seed", "stages"]);
  if (
    typeof value.variant !== "string" ||
    !hasVariant(value.variant) ||
    (value.seed !== undefined &&
      (typeof value.seed !== "string" || !value.seed.trim() || value.seed.length > 128)) ||
    !Array.isArray(value.stages) ||
    !value.stages.length ||
    value.stages.length > 100
  )
    throw invalid();
  let previousTime = -1,
    previousPercentage = 0;
  const stages: { at: number; percentage: number }[] = [];
  for (let index = 0; index < value.stages.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.stages, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw invalid();
    const entry = record(descriptor.value, ["at", "percentage"]);
    if (
      !validScheduleTime(entry.at) ||
      entry.at <= previousTime ||
      !validSchedulePercentage(entry.percentage) ||
      entry.percentage < previousPercentage
    )
      throw invalid();
    previousTime = entry.at;
    previousPercentage = entry.percentage;
    stages.push({ at: entry.at, percentage: entry.percentage });
  }
  return {
    variant: value.variant,
    ...(value.seed !== undefined ? { seed: value.seed as string } : {}),
    stages
  };
}
function record(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor)) throw invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function invalid(): LocalProviderError {
  return new LocalProviderError("SCHEMA_ERROR", "Scheduled rollout is invalid.");
}
