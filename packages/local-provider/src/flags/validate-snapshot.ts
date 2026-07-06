import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type { FlagDefinition, FlagSnapshot, FlagType, FlagValue } from "../public-types.js";
import { flagValueMatchesType, isFlagValue, isJsonObject } from "../evaluator/type-guards.js";

const FLAG_TYPES = new Set<FlagType>(["boolean", "string", "number", "object"]);

export function validateFlagSnapshot(value: unknown): FlagSnapshot {
  if (!isJsonObject(value)) {
    throw schemaError("Flag snapshot must be a JSON object.");
  }

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
    flags[flagKey] = validateFlagDefinition(flagKey, rawFlag);
  }

  const snapshot: FlagSnapshot = {
    schemaVersion: 1,
    flags
  };

  const metadata = validateMetadata(value.metadata, "snapshot metadata");
  if (metadata !== undefined) {
    return { ...snapshot, metadata };
  }

  return snapshot;
}

function validateFlagDefinition(flagKey: string, value: unknown): FlagDefinition {
  if (!isJsonObject(value)) {
    throw schemaError(`Flag "${flagKey}" must be an object.`);
  }

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

  if (!(value.defaultVariant in variants)) {
    throw schemaError(`Flag "${flagKey}" defaultVariant must reference an existing variant.`);
  }

  const flag: FlagDefinition = {
    type: type as FlagType,
    variants,
    defaultVariant: value.defaultVariant
  };

  const envVar = validateOptionalString(value.envVar, `Flag "${flagKey}" envVar`);
  const metadata = validateMetadata(value.metadata, `Flag "${flagKey}" metadata`);

  return {
    ...flag,
    ...(envVar !== undefined ? { envVar } : {}),
    ...(metadata !== undefined ? { metadata } : {})
  };
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
    variants[variantKey] = variantValue;
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
    metadata[key] = metadataValue;
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

function schemaError(message: string): LocalProviderError {
  return new LocalProviderError(LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR, message);
}
