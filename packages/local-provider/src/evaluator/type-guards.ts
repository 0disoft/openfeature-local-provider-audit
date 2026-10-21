import type { FlagType, FlagValue, JsonObject, JsonValue } from "../core-types.js";

export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return isJsonValue(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  // Bound traversal before snapshot cloning/freezing or hashing can recurse.
  const active = new WeakSet<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  let nodes = 0;
  try {
    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry === undefined) break;
      const current = entry.value;
      if (entry.exit) {
        active.delete(current as object);
        continue;
      }
      if (++nodes > 100_000 || entry.depth > 128) return false;
      if (current === null || typeof current === "string" || typeof current === "boolean") continue;
      if (typeof current === "number") {
        if (!Number.isFinite(current)) return false;
        continue;
      }
      if (typeof current !== "object" || active.has(current)) return false;
      active.add(current);
      stack.push({ value: current, depth: entry.depth, exit: true });
      const keys = Object.keys(current);
      if (keys.length + nodes > 100_000 || stack.length + keys.length > 200_000) return false;
      if (Array.isArray(current) && keys.length !== current.length) return false;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor)) return false;
        stack.push({ value: descriptor.value, depth: entry.depth + 1 });
      }
    }
    return true;
  } catch {
    return false;
  }
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
      return value !== null && typeof value === "object";
  }
}
