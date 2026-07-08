import type {
  EnvOverrideState,
  EnvSource,
  FlagSnapshot,
  FlagType,
  FlagValue
} from "../public-types.js";
import { flagValueMatchesType, isFlagValue } from "../evaluator/type-guards.js";

interface CreateEnvOverridesOptions {
  readonly overridesJson?: string;
  readonly env?: EnvSource;
}

type ParseEnvValueResult =
  | {
      readonly ok: true;
      readonly value: FlagValue;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

export function createEnvOverrides(
  snapshot: FlagSnapshot,
  options: CreateEnvOverridesOptions = {}
): EnvOverrideState {
  const values: Record<string, FlagValue> = {};
  const errors: Record<string, string> = {};

  applyPerFlagEnvOverrides(snapshot, options.env ?? {}, values, errors);

  if (options.overridesJson !== undefined) {
    const parsed = parseJsonOverrideMap(options.overridesJson);
    if (typeof parsed === "string") {
      return {
        values,
        errors,
        globalError: parsed
      };
    }

    for (const [flagKey, value] of Object.entries(parsed)) {
      defineRecordEntry(values, flagKey, value);
      delete errors[flagKey];
    }
  }

  return {
    values,
    errors
  };
}

function applyPerFlagEnvOverrides(
  snapshot: FlagSnapshot,
  env: EnvSource,
  values: Record<string, FlagValue>,
  errors: Record<string, string>
): void {
  for (const [flagKey, flag] of Object.entries(snapshot.flags)) {
    if (flag.envVar === undefined) {
      continue;
    }

    const rawValue = env[flag.envVar];
    if (rawValue === undefined) {
      continue;
    }

    const parsed = parseEnvValue(rawValue, flag.type);
    if (!parsed.ok) {
      defineRecordEntry(errors, flagKey, parsed.error);
      continue;
    }

    defineRecordEntry(values, flagKey, parsed.value);
  }
}

function parseJsonOverrideMap(json: string): Record<string, FlagValue> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return "Override JSON could not be parsed.";
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "Override JSON must be an object keyed by flag key.";
  }

  const values: Record<string, FlagValue> = {};
  for (const [flagKey, value] of Object.entries(parsed)) {
    if (!isFlagValue(value)) {
      return `Override JSON value for "${flagKey}" is not a supported flag value.`;
    }
    defineRecordEntry(values, flagKey, value);
  }

  return values;
}

function parseEnvValue(value: string, flagType: FlagType): ParseEnvValueResult {
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return envValueError("Object env override must be valid JSON.");
      }
      if (!isFlagValue(parsed) || !flagValueMatchesType(parsed, "object")) {
        return envValueError("Object env override must parse to a JSON object or array.");
      }
      return parsedEnvValue(parsed);
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
