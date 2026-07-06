import type { FlagType, FlagValue, JsonObject, JsonValue } from "../public-types.js";

export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value) || typeof value !== "number";
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonObject(value);
}

export function isFlagValue(value: unknown): value is FlagValue {
  return isJsonValue(value);
}

export function flagValueMatchesType(value: FlagValue, expectedType: FlagType): boolean {
  switch (expectedType) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return typeof value === "object";
  }
}
