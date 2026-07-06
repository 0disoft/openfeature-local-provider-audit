import type { EvaluationReason, EvaluationSource } from "./reasons.js";
import type { LocalProviderErrorCode } from "./errors/error-codes.js";

export type FlagType = "boolean" | "string" | "number" | "object";

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type FlagValue = JsonValue;

export interface PercentageRolloutRule {
  readonly variant: string;
  readonly percentage: number;
  readonly seed?: string;
}

export interface FlagDefinition {
  readonly type: FlagType;
  readonly variants: Readonly<Record<string, FlagValue>>;
  readonly defaultVariant: string;
  readonly rollout?: readonly PercentageRolloutRule[];
  readonly envVar?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface FlagSnapshot {
  readonly schemaVersion: 1;
  readonly flags: Readonly<Record<string, FlagDefinition>>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface EvaluationRequest<T extends FlagValue = FlagValue> {
  readonly flagKey: string;
  readonly defaultValue: T;
  readonly expectedType: FlagType;
  readonly overrides?: EnvOverrideState;
}

export interface EvaluationResult<T extends FlagValue = FlagValue> {
  readonly flagKey: string;
  readonly value: T;
  readonly variant?: string;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
  readonly errorMessage?: string;
  readonly flagMetadata: Readonly<Record<string, string | number | boolean>>;
}

export interface LocalProviderOptions {
  readonly snapshot: FlagSnapshot;
  readonly name?: string;
  readonly overridesJson?: string;
  readonly env?: EnvSource;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}
