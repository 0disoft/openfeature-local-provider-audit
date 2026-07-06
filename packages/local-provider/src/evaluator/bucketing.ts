import { createHash } from "node:crypto";
import type { PercentageRolloutRule } from "../public-types.js";

const DEFAULT_BUCKETING_SEED = "v1";
const BUCKET_SCALE = 100_000;
const PERCENTAGE_SCALE = 1_000;

export interface RolloutSelection {
  readonly bucket: number;
  readonly variant?: string;
}

export function selectRolloutVariant(
  flagKey: string,
  targetingKey: string,
  rollout: readonly PercentageRolloutRule[]
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

export function computeBucket(
  flagKey: string,
  targetingKey: string,
  seed = DEFAULT_BUCKETING_SEED
): number {
  const canonicalInput = `${seed}\n${flagKey}\n${targetingKey}`;
  const digest = createHash("sha256").update(canonicalInput, "utf8").digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(BUCKET_SCALE));
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
