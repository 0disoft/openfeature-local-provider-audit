import { getOwn } from "./own-property.js";
import type { PercentageRolloutRule } from "../core-types.js";

export type ComputeBucket = (flagKey: string, targetingKey: string, seed?: string) => number;
const DEFAULT_BUCKETING_SEED = "v1";
const PERCENTAGE_SCALE = 1_000;

const MIN_INDEXED_ROLLOUT_SIZE = 16;
interface RolloutIndex {
  readonly seed: string;
  readonly upperBounds: readonly number[];
}
const rolloutIndexes = new WeakMap<readonly PercentageRolloutRule[], RolloutIndex>();

// Called only for fresh validator-owned rules, never merely caller-frozen arrays.
export function indexValidatedRollout(rollout: readonly PercentageRolloutRule[]): void {
  if (rollout.length < MIN_INDEXED_ROLLOUT_SIZE) return;
  let upperBound = 0;
  let seed: string | undefined;
  const upperBounds = rollout.map((rule) => {
    seed ??= getOwn(rule, "seed");
    upperBound += percentageToBucketCount(rule.percentage);
    return upperBound;
  });
  rolloutIndexes.set(rollout, { seed: seed ?? DEFAULT_BUCKETING_SEED, upperBounds });
}

// First strictly greater upper bound; equal boundary belongs to the following rule.
function findRolloutIndex(bounds: readonly number[], bucket: number): number {
  let low = 0;
  let high = bounds.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bucket < (bounds[middle] ?? 0)) high = middle;
    else low = middle + 1;
  }
  return low;
}

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
  const indexed = rolloutIndexes.get(rollout);
  const bucket = computeBucket(flagKey, targetingKey, indexed?.seed ?? getRolloutSeed(rollout));
  if (indexed !== undefined) {
    const variant = rollout[findRolloutIndex(indexed.upperBounds, bucket)]?.variant;
    return variant === undefined ? { bucket } : { bucket, variant };
  }
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
    const seed = getOwn(rule, "seed");
    if (seed !== undefined) {
      return seed;
    }
  }

  return DEFAULT_BUCKETING_SEED;
}
