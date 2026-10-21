import { createHash } from "node:crypto";

const DEFAULT_BUCKETING_SEED = "v1";
const BUCKET_SCALE = 100_000;
export function computeBucket(
  flagKey: string,
  targetingKey: string,
  seed = DEFAULT_BUCKETING_SEED
): number {
  const canonicalInput = `${seed}\n${flagKey}\n${targetingKey}`;
  const digest = createHash("sha256").update(canonicalInput, "utf8").digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(BUCKET_SCALE));
}
