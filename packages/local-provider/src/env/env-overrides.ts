import { getOwn } from "../evaluator/own-property.js";
import type {
  CreateEnvOverridesOptions,
  EnvOverrideState,
  EnvSource,
  FlagSnapshot,
  FlagType,
  FlagValue
} from "../public-types.js";
import { flagValueMatchesType, isFlagValue } from "../evaluator/type-guards.js";

const DEFAULT_MAX_OVERRIDES_JSON_BYTES = 10 * 1024 * 1024;

type ParseEnvValueResult =
  | {
      readonly ok: true;
      readonly value: FlagValue;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

interface ObjectOverrideEntry {
  readonly input: string;
  readonly result: ParseEnvValueResult;
}

interface ObjectOverrideCache {
  last?: ObjectOverrideEntry;
  readonly bindings: Map<string, ObjectOverrideEntry>;
}

export function createEnvOverrides(
  snapshot: FlagSnapshot,
  options: CreateEnvOverridesOptions = {}
): EnvOverrideState {
  const values = createSafeRecord<FlagValue>();
  const errors = createSafeRecord<string>();

  applyPerFlagEnvOverrides(snapshot, options.env ?? {}, values, errors);

  if (options.overridesJson !== undefined) {
    const parsed = parseJsonOverrideMap(
      options.overridesJson,
      options.maxOverridesJsonBytes ?? DEFAULT_MAX_OVERRIDES_JSON_BYTES
    );
    if (typeof parsed === "string") {
      return freezeOverrides({
        values,
        errors,
        globalError: parsed
      });
    }

    for (const [flagKey, value] of Object.entries(parsed)) {
      defineRecordEntry(values, flagKey, value);
      delete errors[flagKey];
    }
  }

  return freezeOverrides({
    values,
    errors
  });
}

function freezeOverrides(state: EnvOverrideState): EnvOverrideState {
  const pending: object[] = [state];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === undefined || Object.isFrozen(value)) continue;
    for (const child of Object.values(value))
      if (child !== null && typeof child === "object") pending.push(child);
    Object.freeze(value);
  }
  return state;
}

function applyPerFlagEnvOverrides(
  snapshot: FlagSnapshot,
  env: EnvSource,
  values: Record<string, FlagValue>,
  errors: Record<string, string>
): void {
  const objectCache: ObjectOverrideCache = { bindings: new Map() };
  for (const [flagKey, flag] of Object.entries(snapshot.flags)) {
    const envVar = getOwn(flag, "envVar");
    if (envVar === undefined) {
      continue;
    }

    const rawValue = env[envVar];
    if (rawValue === undefined) {
      continue;
    }

    const parsed = parseEnvValue(rawValue, flag.type, objectCache, envVar);
    if (!parsed.ok) {
      defineRecordEntry(errors, flagKey, parsed.error);
      continue;
    }

    defineRecordEntry(values, flagKey, parsed.value);
  }
}

function parseJsonOverrideMap(json: string, maxBytes: number): Record<string, FlagValue> | string {
  assertPositiveInteger(maxBytes, "maxOverridesJsonBytes");
  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    return `Override JSON exceeds maxOverridesJsonBytes (${maxBytes}).`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return "Override JSON could not be parsed.";
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "Override JSON must be an object keyed by flag key.";
  }

  const values = createSafeRecord<FlagValue>();
  for (const [flagKey, value] of Object.entries(parsed)) {
    if (!isFlagValue(value)) {
      return `Override JSON value for "${flagKey}" is not a supported flag value.`;
    }
    defineRecordEntry(values, flagKey, value);
  }

  return values;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function parseEnvValue(
  value: string,
  flagType: FlagType,
  objectCache: ObjectOverrideCache,
  binding: string
): ParseEnvValueResult {
  switch (flagType) {
    case "boolean":
      if (value === "true") {
        return parsedEnvValue(true);
      }
      if (value === "false") {
        return parsedEnvValue(false);
      }
      return envValueError("Boolean env override must be exactly true or false.");
    case "string":
      return parsedEnvValue(value);
    case "number": {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return envValueError("Number env override must not be empty.");
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed)
        ? parsedEnvValue(parsed)
        : envValueError("Number env override must be finite.");
    }
    case "object": {
      if (typeof value === "string") {
        const cached =
          objectCache.last?.input === value ? objectCache.last : objectCache.bindings.get(binding);
        if (cached?.input === value) {
          objectCache.last = cached;
          objectCache.bindings.set(binding, cached);
          return cached.result;
        }
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return envValueError("Object env override must be valid JSON.");
      }
      if (!isFlagValue(parsed) || !flagValueMatchesType(parsed, "object")) {
        return envValueError("Object env override must parse to a JSON object or array.");
      }
      const result = parsedEnvValue(parsed);
      // Keep only the last successful input per binding, within this creation.
      if (typeof value === "string") {
        const entry = { input: value, result };
        objectCache.last = entry;
        objectCache.bindings.set(binding, entry);
      }
      return result;
    }
  }
}

function parsedEnvValue(value: FlagValue): ParseEnvValueResult {
  return {
    ok: true,
    value
  };
}

function envValueError(error: string): ParseEnvValueResult {
  return {
    ok: false,
    error
  };
}

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function createSafeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
