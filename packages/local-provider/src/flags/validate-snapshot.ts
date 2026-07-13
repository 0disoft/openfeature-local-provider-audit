import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type {
  FlagDefinition,
  FlagSnapshot,
  FlagType,
  FlagValue,
  JsonValue,
  PercentageRolloutRule
} from "../public-types.js";
import { flagValueMatchesType, isFlagValue, isJsonObject } from "../evaluator/type-guards.js";

const FLAG_TYPES = new Set<FlagType>(["boolean", "string", "number", "object"]);
const SNAPSHOT_KEYS = new Set(["schemaVersion", "flags", "metadata"]);
const FLAG_DEFINITION_KEYS = new Set([
  "type",
  "variants",
  "defaultVariant",
  "rollout",
  "envVar",
  "metadata"
]);
const ROLLOUT_RULE_KEYS = new Set(["variant", "percentage", "seed"]);

export function validateFlagSnapshot(value: unknown): FlagSnapshot {
  if (!isJsonObject(value)) {
    throw schemaError("Flag snapshot must be a JSON object.");
  }
  rejectUnknownKeys(value, SNAPSHOT_KEYS, "Flag snapshot");

  if (value.schemaVersion !== 1) {
    throw schemaError("Flag snapshot schemaVersion must be 1.");
  }

  if (!isJsonObject(value.flags)) {
    throw schemaError("Flag snapshot flags must be an object.");
  }

  const flags: Record<string, FlagDefinition> = {};

  for (const [flagKey, rawFlag] of Object.entries(value.flags)) {
    if (!flagKey.trim()) {
      throw schemaError("Flag keys must be non-empty strings.");
    }
    defineRecordEntry(flags, flagKey, validateFlagDefinition(flagKey, rawFlag));
  }

  const snapshot: FlagSnapshot = {
    schemaVersion: 1,
    flags
  };

  const metadata = validateMetadata(value.metadata, "snapshot metadata");
  if (metadata !== undefined) {
    return deepFreeze({ ...snapshot, metadata });
  }

  return deepFreeze(snapshot);
}

function validateFlagDefinition(flagKey: string, value: unknown): FlagDefinition {
  if (!isJsonObject(value)) {
    throw schemaError(`Flag "${flagKey}" must be an object.`);
  }
  rejectUnknownKeys(value, FLAG_DEFINITION_KEYS, `Flag "${flagKey}"`);

  const type = value.type;
  if (typeof type !== "string" || !FLAG_TYPES.has(type as FlagType)) {
    throw schemaError(`Flag "${flagKey}" has an unsupported type.`);
  }

  if (!isJsonObject(value.variants)) {
    throw schemaError(`Flag "${flagKey}" variants must be an object.`);
  }

  const variants = validateVariants(flagKey, type as FlagType, value.variants);

  if (typeof value.defaultVariant !== "string" || !value.defaultVariant.trim()) {
    throw schemaError(`Flag "${flagKey}" defaultVariant must be a non-empty string.`);
  }

  if (!hasOwn(variants, value.defaultVariant)) {
    throw schemaError(`Flag "${flagKey}" defaultVariant must reference an existing variant.`);
  }

  const flag: FlagDefinition = {
    type: type as FlagType,
    variants,
    defaultVariant: value.defaultVariant
  };

  const envVar = validateOptionalString(value.envVar, `Flag "${flagKey}" envVar`);
  const rollout = validateRollout(flagKey, value.rollout, variants);
  const metadata = validateMetadata(value.metadata, `Flag "${flagKey}" metadata`);

  return {
    ...flag,
    ...(envVar !== undefined ? { envVar } : {}),
    ...(rollout !== undefined ? { rollout } : {}),
    ...(metadata !== undefined ? { metadata } : {})
  };
}

function validateRollout(
  flagKey: string,
  value: unknown,
  variants: Readonly<Record<string, FlagValue>>
): readonly PercentageRolloutRule[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw schemaError(`Flag "${flagKey}" rollout must be a non-empty array when provided.`);
  }

  const rollout: PercentageRolloutRule[] = [];
  const seeds = new Set<string>();
  let totalBuckets = 0;

  for (const [index, rawRule] of value.entries()) {
    if (!isJsonObject(rawRule)) {
      throw schemaError(`Flag "${flagKey}" rollout rule ${index} must be an object.`);
    }
    rejectUnknownKeys(rawRule, ROLLOUT_RULE_KEYS, `Flag "${flagKey}" rollout rule ${index}`);

    const variant = validateRolloutVariant(flagKey, index, rawRule.variant, variants);
    const percentage = validateRolloutPercentage(flagKey, index, rawRule.percentage);
    const seed = validateOptionalString(
      rawRule.seed,
      `Flag "${flagKey}" rollout rule ${index} seed`
    );

    totalBuckets += Math.round(percentage * 1_000);
    if (totalBuckets > 100_000) {
      throw schemaError(`Flag "${flagKey}" rollout percentages must not exceed 100.`);
    }

    if (seed !== undefined) {
      seeds.add(seed);
    }
    if (seeds.size > 1) {
      throw schemaError(`Flag "${flagKey}" rollout rules must use one shared seed.`);
    }

    rollout.push({
      variant,
      percentage,
      ...(seed !== undefined ? { seed } : {})
    });
  }

  return rollout;
}

function validateRolloutVariant(
  flagKey: string,
  index: number,
  value: unknown,
  variants: Readonly<Record<string, FlagValue>>
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw schemaError(
      `Flag "${flagKey}" rollout rule ${index} variant must be a non-empty string.`
    );
  }
  if (!hasOwn(variants, value)) {
    throw schemaError(
      `Flag "${flagKey}" rollout rule ${index} variant must reference an existing variant.`
    );
  }
  return value;
}

function validateRolloutPercentage(flagKey: string, index: number, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw schemaError(
      `Flag "${flagKey}" rollout rule ${index} percentage must be greater than 0 and at most 100.`
    );
  }

  const scaled = value * 1_000;
  if (Math.abs(scaled - Math.round(scaled)) > Number.EPSILON * 1_000) {
    throw schemaError(
      `Flag "${flagKey}" rollout rule ${index} percentage supports up to 3 decimal places.`
    );
  }

  return value;
}

function validateVariants(
  flagKey: string,
  flagType: FlagType,
  value: Record<string, unknown>
): Readonly<Record<string, FlagValue>> {
  const variants: Record<string, FlagValue> = {};

  for (const [variantKey, variantValue] of Object.entries(value)) {
    if (!variantKey.trim()) {
      throw schemaError(`Flag "${flagKey}" variant keys must be non-empty strings.`);
    }
    if (!isFlagValue(variantValue)) {
      throw schemaError(`Flag "${flagKey}" variant "${variantKey}" must be a valid flag value.`);
    }
    if (!flagValueMatchesType(variantValue, flagType)) {
      throw schemaError(`Flag "${flagKey}" variant "${variantKey}" does not match type.`);
    }
    defineRecordEntry(variants, variantKey, cloneJsonValue(variantValue));
  }

  if (Object.keys(variants).length === 0) {
    throw schemaError(`Flag "${flagKey}" must define at least one variant.`);
  }

  return variants;
}

function validateMetadata(
  value: unknown,
  label: string
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    throw schemaError(`${label} must be an object when provided.`);
  }

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, metadataValue] of Object.entries(value)) {
    if (
      typeof metadataValue !== "string" &&
      typeof metadataValue !== "number" &&
      typeof metadataValue !== "boolean"
    ) {
      throw schemaError(`${label} values must be strings, numbers, or booleans.`);
    }
    defineRecordEntry(metadata, key, metadataValue);
  }

  return metadata;
}

function validateOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw schemaError(`${label} must be a non-empty string when provided.`);
  }
  return value;
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  label: string
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw schemaError(`${label} contains unknown field(s): ${unknownKeys.join(", ")}.`);
  }
}

function schemaError(message: string): LocalProviderError {
  return new LocalProviderError(LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR, message);
}

function hasOwn<T>(record: Readonly<Record<string, T>>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function cloneJsonValue(value: FlagValue): FlagValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }

  if (value !== null && typeof value === "object") {
    const cloned: Record<string, JsonValue> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      defineRecordEntry(cloned, key, cloneJsonValue(entryValue));
    }
    return cloned;
  }

  return value;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const entryValue of Object.values(value)) {
    deepFreeze(entryValue);
  }

  return Object.freeze(value);
}
