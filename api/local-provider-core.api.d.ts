//#region src/reasons.d.ts
export declare const EVALUATION_REASONS: {
  readonly STATIC: "STATIC";
  readonly DEFAULT: "DEFAULT";
  readonly ENV_OVERRIDE: "ENV_OVERRIDE";
  readonly SPLIT: "SPLIT";
  readonly TARGETING_MATCH: "TARGETING_MATCH";
  readonly DISABLED: "DISABLED";
  readonly ERROR: "ERROR";
};
type EvaluationReason = (typeof EVALUATION_REASONS)[keyof typeof EVALUATION_REASONS];
export declare const EVALUATION_SOURCES: {
  readonly FILE: "file";
  readonly ENV: "env";
  readonly DEFAULT: "default";
  readonly ERROR: "error";
};
type EvaluationSource = (typeof EVALUATION_SOURCES)[keyof typeof EVALUATION_SOURCES];
//#endregion
//#region src/errors/error-codes.d.ts
export declare const LOCAL_PROVIDER_ERROR_CODES: {
  readonly PARSE_ERROR: "PARSE_ERROR";
  readonly SCHEMA_ERROR: "SCHEMA_ERROR";
  readonly FLAG_NOT_FOUND: "FLAG_NOT_FOUND";
  readonly TYPE_MISMATCH: "TYPE_MISMATCH";
  readonly INVALID_CONTEXT: "INVALID_CONTEXT";
  readonly OVERRIDE_PARSE_ERROR: "OVERRIDE_PARSE_ERROR";
  readonly PROVIDER_NOT_READY: "PROVIDER_NOT_READY";
  readonly AUDIT_SINK_ERROR: "AUDIT_SINK_ERROR";
};
type LocalProviderErrorCode =
  (typeof LOCAL_PROVIDER_ERROR_CODES)[keyof typeof LOCAL_PROVIDER_ERROR_CODES];
//#endregion
//#region src/core-types.d.ts
type FlagType = "boolean" | "string" | "number" | "object";
type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
type JsonObject = {
  readonly [key: string]: JsonValue;
};
type FlagValue = JsonValue;
interface PercentageRolloutRule {
  readonly variant: string;
  readonly percentage: number;
  readonly seed?: string;
}
interface FlagDefinition {
  readonly schedule?: ScheduledRollout;
  readonly type: FlagType;
  readonly variants: Readonly<Record<string, FlagValue>>;
  readonly defaultVariant: string;
  readonly rollout?: readonly PercentageRolloutRule[];
  readonly envVar?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly rules?: readonly TargetingRule[];
  readonly disabledVariant?: string;
}
type ConditionScalar = string | number | boolean | null;
interface ScheduledRollout {
  readonly variant: string;
  readonly seed?: string;
  readonly stages: readonly {
    readonly at: number;
    readonly percentage: number;
  }[];
}
interface ScheduleEvaluation {
  readonly evaluatedAt: number;
  readonly stage: number | null;
  readonly percentage: number;
}
type TargetingCondition =
  | {
      readonly all: readonly TargetingCondition[];
    }
  | {
      readonly any: readonly TargetingCondition[];
    }
  | {
      readonly attribute: readonly string[];
      readonly op: "eq";
      readonly value: ConditionScalar;
    }
  | {
      readonly attribute: readonly string[];
      readonly op: "in";
      readonly value: readonly ConditionScalar[];
    }
  | {
      readonly attribute: readonly string[];
      readonly op: "gt" | "gte" | "lt" | "lte";
      readonly value: number;
    }
  | {
      readonly attribute: readonly string[];
      readonly op: "semverEq" | "semverGt" | "semverGte" | "semverLt" | "semverLte";
      readonly value: string;
    };
type TargetingRule = {
  readonly id: string;
  readonly when: TargetingCondition;
} & (
  | {
      readonly variant: string;
      readonly rollout?: never;
    }
  | {
      readonly variant?: never;
      readonly rollout: readonly PercentageRolloutRule[];
    }
);
interface FlagSnapshot {
  readonly schemaVersion: 1 | 2;
  readonly flags: Readonly<Record<string, FlagDefinition>>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}
interface EvaluationRequestBase {
  readonly evaluationTime?: number;
  readonly flagKey: string;
  readonly targetingKey?: string;
  readonly context?: EvaluationContext;
  readonly overrides?: EnvOverrideState;
}
type EvaluationRequestByType<T extends FlagValue> =
  | (EvaluationRequestBase & {
      readonly defaultValue: Extract<T, boolean>;
      readonly expectedType: "boolean";
    })
  | (EvaluationRequestBase & {
      readonly defaultValue: Extract<T, string>;
      readonly expectedType: "string";
    })
  | (EvaluationRequestBase & {
      readonly defaultValue: Extract<T, number>;
      readonly expectedType: "number";
    })
  | (EvaluationRequestBase & {
      readonly defaultValue: Extract<T, object | null>;
      readonly expectedType: "object";
    });
type EvaluationRequest<T extends FlagValue = FlagValue> = EvaluationRequestByType<T>;
type EvaluationContext = Readonly<Record<string, unknown>>;
interface EvaluationResult<T extends FlagValue = FlagValue> {
  readonly schedule?: ScheduleEvaluation;
  readonly flagKey: string;
  readonly value: T;
  readonly variant?: string;
  readonly ruleId?: string;
  readonly bucket?: number;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
  readonly errorMessage?: string;
  readonly flagMetadata: Readonly<Record<string, string | number | boolean>>;
}
interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}
//#endregion
//#region src/errors/local-provider-error.d.ts
export declare class LocalProviderError extends Error {
  readonly code: LocalProviderErrorCode;
  constructor(code: LocalProviderErrorCode, message: string);
}
export declare function isLocalProviderError(value: unknown): value is LocalProviderError;
//#endregion
//#region src/flags/parse-json-snapshot.d.ts
export declare function parseJsonFlagSnapshot(json: string): FlagSnapshot;
//#endregion
//#region src/core.d.ts
export declare function evaluateFlag<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationResult<T>;
//#endregion
export type {
  ConditionScalar,
  EnvOverrideState,
  EvaluationContext,
  EvaluationReason,
  EvaluationRequest,
  EvaluationResult,
  EvaluationSource,
  FlagDefinition,
  FlagSnapshot,
  FlagType,
  FlagValue,
  JsonObject,
  JsonValue,
  LocalProviderErrorCode,
  PercentageRolloutRule,
  ScheduleEvaluation,
  ScheduledRollout,
  TargetingCondition,
  TargetingRule
};
//# sourceMappingURL=core.d.ts.map
