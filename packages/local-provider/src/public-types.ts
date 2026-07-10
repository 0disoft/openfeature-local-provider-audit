import type { Provider } from "@openfeature/server-sdk";
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
  readonly maxOverridesJsonBytes?: number;
  readonly env?: EnvSource;
  readonly auditSink?: AuditSink;
  readonly auditWriteMode?: AuditWriteMode;
  readonly auditRedaction?: AuditRedactionOptions;
}

export interface ReloadableLocalProvider extends Provider {
  getSnapshot(): FlagSnapshot;
  updateSnapshot(snapshot: FlagSnapshot): void;
}

export type SnapshotFileFormat = "auto" | "json" | "yaml";

export interface LoadFlagSnapshotFileOptions {
  readonly format?: SnapshotFileFormat;
  readonly encoding?: BufferEncoding;
  readonly maxBytes?: number;
}

export interface WatchFlagSnapshotFileOptions extends LoadFlagSnapshotFileOptions {
  readonly path: string | URL;
  readonly debounceMs?: number;
  readonly persistent?: boolean;
  onSnapshot(snapshot: FlagSnapshot): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
}

export interface FlagSnapshotFileWatcher {
  readonly path: string | URL;
  getSnapshot(): FlagSnapshot | undefined;
  reload(): Promise<FlagSnapshot>;
  close(): void;
}

export type AuditWriteMode = "nonBlocking" | "blocking";

export type AuditContextKeyMode = "names" | "count" | "none";

export interface AuditRedactionOptions {
  readonly contextKeys?: AuditContextKeyMode;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}

export interface CreateEnvOverridesOptions {
  readonly overridesJson?: string;
  readonly maxOverridesJsonBytes?: number;
  readonly env?: EnvSource;
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
  readonly keyMode?: AuditContextKeyMode;
  readonly keys: readonly string[];
  readonly keyCount?: number;
  readonly redacted: true;
}

export interface CreateAuditEventOptions {
  readonly providerName: string;
  readonly snapshot: FlagSnapshot;
  readonly snapshotHash?: string;
  readonly request: EvaluationRequest;
  readonly result: EvaluationResult;
  readonly overrides?: ReplayOverrideInput;
  readonly overrideHash?: string;
  readonly eventId?: string;
  readonly timestamp?: string;
  readonly redaction?: AuditRedactionOptions;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  flush?(): Promise<void>;
  getStats?(): FileAuditSinkStats;
}

export type AuditQueueOverflowPolicy = "reject" | "dropNewest";

export interface FileAuditSinkStats {
  readonly pendingWrites: number;
  readonly droppedWrites: number;
}

export interface FileAuditSinkOptions {
  readonly path: string | URL;
  readonly createDirectory?: boolean;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly lock?: boolean;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly maxQueueSize?: number;
  readonly queueOverflowPolicy?: AuditQueueOverflowPolicy;
}
