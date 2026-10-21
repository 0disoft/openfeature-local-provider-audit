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

export type ConditionScalar = string | number | boolean | null;

export interface ScheduledRollout {
  readonly variant: string;
  readonly seed?: string;
  readonly stages: readonly { readonly at: number; readonly percentage: number }[];
}

export interface ScheduleEvaluation {
  readonly evaluatedAt: number;
  readonly stage: number | null;
  readonly percentage: number;
}

export type TargetingCondition =
  | { readonly all: readonly TargetingCondition[] }
  | { readonly any: readonly TargetingCondition[] }
  | { readonly attribute: readonly string[]; readonly op: "eq"; readonly value: ConditionScalar }
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

export type TargetingRule = {
  readonly id: string;
  readonly when: TargetingCondition;
} & (
  | { readonly variant: string; readonly rollout?: never }
  | { readonly variant?: never; readonly rollout: readonly PercentageRolloutRule[] }
);

export interface FlagSnapshot {
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

export type EvaluationRequest<T extends FlagValue = FlagValue> = EvaluationRequestByType<T>;

export type EvaluationContext = Readonly<Record<string, unknown>>;

export interface EvaluationResult<T extends FlagValue = FlagValue> {
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

export interface RuleExplanation {
  readonly ruleId: string;
  readonly matched: boolean;
}

export interface EvaluationExplanation {
  readonly schedule?: ScheduleEvaluation;
  readonly flagKey: string;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly snapshotHash: string;
  readonly overrideHash?: string;
  readonly variant?: string;
  readonly ruleId?: string;
  readonly bucket?: number;
  readonly errorCode?: LocalProviderErrorCode;
  readonly rules: readonly RuleExplanation[];
}

export interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}
