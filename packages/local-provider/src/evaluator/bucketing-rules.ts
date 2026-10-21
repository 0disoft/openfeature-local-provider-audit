import type { PercentageRolloutRule } from "../core-types.js";

export type ComputeBucket = (flagKey: string, targetingKey: string, seed?: string) => number;
const DEFAULT_BUCKETING_SEED = "v1";
const PERCENTAGE_SCALE = 1_000;

export interface RolloutSelection {
  readonly bucket: number;
  readonly variant?: string;
}

export function selectRolloutVariant(
  flagKey: string,
  targetingKey: string,
  rollout: readonly PercentageRolloutRule[],
  computeBucket: ComputeBucket
): RolloutSelection {
  const bucket = computeBucket(flagKey, targetingKey, getRolloutSeed(rollout));
  let upperBound = 0;

  for (const rule of rollout) {
    upperBound += percentageToBucketCount(rule.percentage);
    if (bucket < upperBound) {
      return {
        bucket,
        variant: rule.variant
      };
    }
  }

  return { bucket };
}

export function percentageToBucketCount(percentage: number): number {
  return Math.round(percentage * PERCENTAGE_SCALE);
}

function getRolloutSeed(rollout: readonly PercentageRolloutRule[]): string {
  for (const rule of rollout) {
    if (rule.seed !== undefined) {
      return rule.seed;
    }
  }

  return DEFAULT_BUCKETING_SEED;
}
