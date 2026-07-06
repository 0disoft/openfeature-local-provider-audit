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
  readonly targetingKey?: string;
  readonly context?: EvaluationContext;
  readonly overrides?: EnvOverrideState;
}

export type EvaluationContext = Readonly<Record<string, unknown>>;

export interface EvaluationResult<T extends FlagValue = FlagValue> {
  readonly flagKey: string;
  readonly value: T;
  readonly variant?: string;
  readonly bucket?: number;
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
  readonly auditSink?: AuditSink;
  readonly auditWriteMode?: AuditWriteMode;
}

export type AuditWriteMode = "nonBlocking" | "blocking";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}

export interface ReplayFixture<T extends FlagValue = FlagValue> {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly snapshot: FlagSnapshot;
  readonly overrides?: ReplayOverrideInput;
  readonly request: EvaluationRequest<T>;
  readonly expected: ReplayExpectedResult<T>;
}

export interface ReplayOverrideInput {
  readonly overridesJson?: string;
  readonly env?: EnvSource;
}

export interface ReplayExpectedResult<T extends FlagValue = FlagValue> {
  readonly value: T;
  readonly variant?: string;
  readonly bucket?: number;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
}

export interface ReplayResult<T extends FlagValue = FlagValue> {
  readonly fixtureName: string;
  readonly passed: boolean;
  readonly expected: ReplayExpectedResult<T>;
  readonly actual: ReplayExpectedResult<T>;
  readonly mismatches: readonly ReplayMismatch[];
}

export interface ReplayMismatch {
  readonly field: string;
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;
}

export interface AuditEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly timestamp: string;
  readonly providerName: string;
  readonly flagKey: string;
  readonly requestedType: FlagType;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly variant?: string;
  readonly errorCode?: LocalProviderErrorCode;
  readonly snapshotHash: string;
  readonly overrideHash?: string;
  readonly context: RedactedAuditContext;
}

export interface RedactedAuditContext {
  readonly targetingKeyPresent: boolean;
  readonly keys: readonly string[];
  readonly redacted: true;
}

export interface CreateAuditEventOptions {
  readonly providerName: string;
  readonly snapshot: FlagSnapshot;
  readonly request: EvaluationRequest;
  readonly result: EvaluationResult;
  readonly overrides?: ReplayOverrideInput;
  readonly eventId?: string;
  readonly timestamp?: string;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  flush?(): Promise<void>;
}

export interface FileAuditSinkOptions {
  readonly path: string | URL;
  readonly createDirectory?: boolean;
}
