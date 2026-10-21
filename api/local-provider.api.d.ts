import { Provider } from "@openfeature/server-sdk";
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
//#region src/errors/local-provider-error.d.ts
export declare class LocalProviderError extends Error {
  readonly code: LocalProviderErrorCode;
  constructor(code: LocalProviderErrorCode, message: string);
}
export declare function isLocalProviderError(value: unknown): value is LocalProviderError;
//#endregion
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
//#region src/public-types.d.ts
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
interface RuleExplanation {
  readonly ruleId: string;
  readonly matched: boolean;
}
interface EvaluationExplanation {
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
interface LocalProviderOptions {
  readonly snapshot: FlagSnapshot;
  readonly name?: string;
  readonly overridesJson?: string;
  readonly maxOverridesJsonBytes?: number;
  readonly env?: EnvSource;
  readonly auditSink?: AuditSink;
  readonly auditWriteMode?: AuditWriteMode;
  readonly auditFailurePolicy?: AuditFailurePolicy;
  readonly auditTimeoutMs?: number;
  readonly auditRedaction?: AuditRedactionOptions;
  readonly staleAfterMs?: number;
  readonly metrics?: ProviderMetrics;
}
interface ProviderEvaluationMetric {
  readonly requestedType: FlagType;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
  readonly durationMs: number;
}
interface ProviderMetricsSession {
  recordEvaluation(metric: ProviderEvaluationMetric): void;
  close(): void;
}
interface ProviderMetrics {
  bindStatus(readStatus: () => ProviderStatus, sink?: AuditSink): ProviderMetricsSession;
}
interface OpenTelemetryMeter {
  createCounter(
    name: string,
    options?: {
      unit?: string;
      description?: string;
    }
  ): {
    add(value: number, attributes?: Readonly<Record<string, string>>): void;
  };
  createHistogram(
    name: string,
    options?: {
      unit?: string;
      description?: string;
    }
  ): {
    record(value: number, attributes?: Readonly<Record<string, string>>): void;
  };
  createObservableGauge(
    name: string,
    options?: {
      unit?: string;
      description?: string;
    }
  ): {
    addCallback(
      callback: (result: {
        observe(value: number, attributes?: Readonly<Record<string, string>>): void;
      }) => void
    ): void;
    removeCallback(
      callback: (result: {
        observe(value: number, attributes?: Readonly<Record<string, string>>): void;
      }) => void
    ): void;
  };
}
type RefreshFailureKind = "load" | "fetch" | "validation" | "signature" | "persist";
interface ProviderAuditStatus {
  readonly enabled: boolean;
  readonly attemptedWrites: number;
  readonly resolvedWrites: number;
  readonly failedWrites: number;
  readonly timedOutWrites: number;
  readonly pendingWrites: number;
  readonly lastFailureAt?: number;
  readonly sinkStats?: FileAuditSinkStats;
}
interface ProviderStatus {
  readonly snapshotHash: string;
  readonly closed: boolean;
  readonly lastSuccessfulRefreshAt: number;
  readonly lastChangedAt: number;
  readonly successfulRefreshes: number;
  readonly failedRefreshes: number;
  readonly consecutiveRefreshFailures: number;
  readonly lastRefreshFailureAt?: number;
  readonly lastRefreshFailure?: RefreshFailureKind;
  readonly stale: boolean;
  readonly audit: ProviderAuditStatus;
}
interface ObservableLocalProvider extends Provider {
  getStatus(): ProviderStatus;
  reportRefreshFailure(kind: RefreshFailureKind): void;
}
interface ReloadableLocalProvider extends ObservableLocalProvider {
  getSnapshot(): FlagSnapshot;
  updateSnapshot(snapshot: FlagSnapshot): void;
}
type SnapshotFileFormat = "auto" | "json" | "yaml";
interface LoadFlagSnapshotFileOptions {
  readonly format?: SnapshotFileFormat;
  readonly encoding?: BufferEncoding;
  readonly maxBytes?: number;
}
interface WatchFlagSnapshotFileOptions extends LoadFlagSnapshotFileOptions {
  readonly path: string | URL;
  readonly debounceMs?: number;
  readonly consistencyPollIntervalMs?: number;
  readonly persistent?: boolean;
  onSnapshot(snapshot: FlagSnapshot): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
}
interface FlagSnapshotFileWatcher {
  readonly path: string | URL;
  getSnapshot(): FlagSnapshot | undefined;
  reload(): Promise<FlagSnapshot>;
  close(): void;
}
type AuditWriteMode = "nonBlocking" | "blocking";
type AuditFailurePolicy = "bestEffort" | "returnDefault";
type AuditContextKeyMode = "names" | "count" | "none";
interface AuditRedactionOptions {
  readonly contextKeys?: AuditContextKeyMode;
}
type EnvSource = Readonly<Record<string, string | undefined>>;
interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}
interface CreateEnvOverridesOptions {
  readonly overridesJson?: string;
  readonly maxOverridesJsonBytes?: number;
  readonly env?: EnvSource;
}
interface ReplayFixture<T extends FlagValue = FlagValue> {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly snapshot: FlagSnapshot;
  readonly overrides?: ReplayOverrideInput;
  readonly request: EvaluationRequest<T>;
  readonly expected: ReplayExpectedResult<T>;
}
interface ReplayOverrideInput {
  readonly overridesJson?: string;
  readonly env?: EnvSource;
}
interface ReplayExpectedResult<T extends FlagValue = FlagValue> {
  readonly value: T;
  readonly variant?: string;
  readonly ruleId?: string;
  readonly bucket?: number;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
}
interface ReplayResult<T extends FlagValue = FlagValue> {
  readonly fixtureName: string;
  readonly passed: boolean;
  readonly expected: ReplayExpectedResult<T>;
  readonly actual: ReplayExpectedResult<T>;
  readonly mismatches: readonly ReplayMismatch[];
}
interface ReplayMismatch {
  readonly field: string;
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;
}
interface AuditEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly timestamp: string;
  readonly providerName: string;
  readonly flagKey: string;
  readonly requestedType: FlagType;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly variant?: string;
  readonly ruleId?: string;
  readonly errorCode?: LocalProviderErrorCode;
  readonly snapshotHash: string;
  readonly overrideHash?: string;
  readonly context: RedactedAuditContext;
}
interface RedactedAuditContext {
  readonly targetingKeyPresent: boolean;
  readonly keyMode?: AuditContextKeyMode;
  readonly keys: readonly string[];
  readonly keyCount?: number;
  readonly redacted: true;
}
interface CreateAuditEventOptions {
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
interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  writeConfirmed?(event: AuditEvent): Promise<void>;
  flush?(): Promise<void>;
  getStats?(): FileAuditSinkStats;
}
type AuditQueueOverflowPolicy = "reject" | "dropNewest";
interface FileAuditSinkStats {
  readonly pendingWrites: number;
  readonly droppedWrites: number;
  readonly rejectedWrites: number;
  readonly maxQueueSize: number | null;
}
interface FileAuditSinkOptions {
  readonly path: string | URL;
  readonly createDirectory?: boolean;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly lock?: boolean;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly maxQueueSize?: number | null;
  readonly queueOverflowPolicy?: AuditQueueOverflowPolicy;
}
//#endregion
//#region src/flags/parse-json-snapshot.d.ts
export declare function parseJsonFlagSnapshot(json: string): FlagSnapshot;
//#endregion
//#region src/flags/parse-yaml-snapshot.d.ts
export declare function parseYamlFlagSnapshot(yaml: string): FlagSnapshot;
//#endregion
//#region src/flags/snapshot-file.d.ts
export declare function loadFlagSnapshotFile(
  path: string | URL,
  options?: LoadFlagSnapshotFileOptions
): Promise<FlagSnapshot>;
export declare function watchFlagSnapshotFile(
  options: WatchFlagSnapshotFileOptions
): Promise<FlagSnapshotFileWatcher>;
//#endregion
//#region src/env/env-overrides.d.ts
export declare function createEnvOverrides(
  snapshot: FlagSnapshot,
  options?: CreateEnvOverridesOptions
): EnvOverrideState;
//#endregion
//#region src/evaluator/evaluate.d.ts
export declare function evaluateFlag<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationResult<T>;
//#endregion
//#region src/evaluator/explain.d.ts
export declare function explainEvaluation<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationExplanation;
//#endregion
//#region src/provider/local-provider.d.ts
export declare function createLocalProvider(options: LocalProviderOptions): ObservableLocalProvider;
export declare function createReloadableLocalProvider(
  options: LocalProviderOptions
): ReloadableLocalProvider;
//#endregion
//#region src/replay/replay-fixture.d.ts
export declare function replayEvaluationFixture<T extends FlagValue>(
  fixture: ReplayFixture<T>
): ReplayResult<T>;
//#endregion
//#region src/audit/audit-event.d.ts
export declare function createAuditEvent(options: CreateAuditEventOptions): AuditEvent;
export declare function serializeAuditEvent(event: AuditEvent): string;
export declare function redactContext(
  context?: EvaluationContext,
  options?: AuditRedactionOptions
): RedactedAuditContext;
//#endregion
//#region src/audit/audit-sink.d.ts
export declare function createFileAuditSink(options: FileAuditSinkOptions): AuditSink;
//#endregion
//#region src/metrics/opentelemetry.d.ts
/** Uses a caller-owned Meter; never installs an SDK, exporter, timer or global provider. */
export declare function createOpenTelemetryMetrics(meter: OpenTelemetryMeter): ProviderMetrics;
//#endregion
export type {
  AuditContextKeyMode,
  AuditEvent,
  AuditFailurePolicy,
  AuditQueueOverflowPolicy,
  AuditRedactionOptions,
  AuditSink,
  AuditWriteMode,
  ConditionScalar,
  CreateAuditEventOptions,
  CreateEnvOverridesOptions,
  EnvOverrideState,
  EnvSource,
  EvaluationContext,
  EvaluationExplanation,
  EvaluationReason,
  EvaluationRequest,
  EvaluationResult,
  EvaluationSource,
  FileAuditSinkOptions,
  FileAuditSinkStats,
  FlagDefinition,
  FlagSnapshot,
  FlagSnapshotFileWatcher,
  FlagType,
  FlagValue,
  JsonObject,
  JsonValue,
  LoadFlagSnapshotFileOptions,
  LocalProviderErrorCode,
  LocalProviderOptions,
  ObservableLocalProvider,
  OpenTelemetryMeter,
  PercentageRolloutRule,
  ProviderAuditStatus,
  ProviderEvaluationMetric,
  ProviderMetrics,
  ProviderMetricsSession,
  ProviderStatus,
  RedactedAuditContext,
  RefreshFailureKind,
  ReloadableLocalProvider,
  ReplayExpectedResult,
  ReplayFixture,
  ReplayMismatch,
  ReplayOverrideInput,
  ReplayResult,
  RuleExplanation,
  SnapshotFileFormat,
  TargetingCondition,
  TargetingRule,
  WatchFlagSnapshotFileOptions
};
//# sourceMappingURL=index.d.ts.map
