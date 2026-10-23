import { KeyObject } from "node:crypto";
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
interface RuleExplanation {
  readonly ruleId: string;
  readonly matched: boolean;
}
interface EvaluationExplanation {
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
interface EnvOverrideState {
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly globalError?: string;
}
//#endregion
//#region src/flags/parse-json-snapshot.d.ts
export declare function parseJsonFlagSnapshot(json: string): FlagSnapshot;
//#endregion
//#region src/public-types.d.ts
interface LocalProviderOptions {
  readonly clock?: () => number;
  readonly snapshot: FlagSnapshot;
  readonly provenance?: SignedSnapshotMetadata;
  readonly name?: string;
  readonly overridesJson?: string;
  readonly maxOverridesJsonBytes?: number;
  readonly env?: EnvSource;
  readonly auditSink?: AuditSink;
  readonly auditWriteMode?: AuditWriteMode;
  readonly auditFailurePolicy?: AuditFailurePolicy;
  readonly auditTimeoutMs?: number;
  readonly auditShutdownTimeoutMs?: number;
  readonly auditRedaction?: AuditRedactionOptions;
  readonly auditPseudonymizer?: AuditPseudonymizer;
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
  readonly provenance?: SignedSnapshotMetadata;
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
  updateSnapshot(snapshot: FlagSnapshot, provenance?: SignedSnapshotMetadata): void;
  prepareSnapshot?(
    snapshot: FlagSnapshot,
    provenance?: SignedSnapshotMetadata
  ): SnapshotUpdateTransaction;
}
interface SnapshotUpdateTransaction {
  commit(): void;
  cancel(): void;
}
interface SnapshotSourceRequest {
  readonly etag?: string;
  readonly signal?: AbortSignal;
}
type SnapshotSourceResponse =
  | {
      readonly status: "notModified";
    }
  | {
      readonly status: "content";
      readonly content: Uint8Array;
      readonly etag?: string;
    };
interface SnapshotSource {
  fetch(request?: SnapshotSourceRequest): Promise<SnapshotSourceResponse>;
}
interface HttpsSnapshotSourceOptions {
  readonly url: string | URL;
  readonly ca?: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}
interface S3SnapshotClient {
  getObject(
    input: {
      Bucket: string;
      Key: string;
      IfNoneMatch?: string;
    },
    options: {
      abortSignal: AbortSignal;
    }
  ): Promise<{
    Body?: unknown;
    ContentLength?: number | undefined;
    ContentEncoding?: string | undefined;
    ETag?: string | undefined;
    $metadata?:
      | {
          httpStatusCode?: number | undefined;
        }
      | undefined;
  }>;
}
interface S3SnapshotSourceOptions {
  readonly client: S3SnapshotClient;
  readonly bucket: string;
  readonly key: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}
interface SnapshotRefresherOptions {
  readonly provider: ReloadableLocalProvider;
  readonly source: SnapshotSource;
  readonly format?: "json" | "yaml";
  readonly maxBytes?: number;
  readonly verifier?: SnapshotVerifier;
  readonly previous?: SignedSnapshotMetadata;
  readonly store?: SignedSnapshotStore;
  readonly timeoutMs?: number;
  readonly onFailure?: (failure: {
    readonly kind: RefreshFailureKind;
    readonly cause: unknown;
    readonly timedOut: boolean;
  }) => void;
}
interface SignFlagSnapshotOptions {
  readonly snapshot: FlagSnapshot;
  readonly privateKey: KeyObject;
  readonly keyId: string;
  readonly audience: string;
  readonly sequence: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly maxBytes?: number;
}
interface SnapshotVerificationOptions {
  readonly trustedKeys: Readonly<Record<string, KeyObject | string>>;
  readonly audience: string;
  readonly minSequence?: number;
  readonly maxAgeMs?: number;
  readonly maxLifetimeMs?: number;
  readonly clockSkewMs?: number;
  readonly maxBytes?: number;
}
interface SignedSnapshotMetadata {
  readonly keyId: string;
  readonly audience: string;
  readonly sequence: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly snapshotHash: string;
  readonly artifactHash: string;
}
interface VerifiedFlagSnapshot {
  readonly snapshot: FlagSnapshot;
  readonly provenance: SignedSnapshotMetadata;
}
interface SnapshotVerifier {
  verify(content: Uint8Array, previous?: SignedSnapshotMetadata): VerifiedFlagSnapshot;
}
interface FileSnapshotStoreOptions {
  readonly path: string | URL;
  readonly verification: SnapshotVerificationOptions;
  readonly maxHistory?: number;
  readonly maxBytes?: number;
  readonly createDirectory?: boolean;
}
interface SnapshotRecovery {
  readonly floor: SignedSnapshotMetadata;
  readonly current?: VerifiedFlagSnapshot;
  readonly history: readonly VerifiedFlagSnapshot[];
}
interface SignedSnapshotStore {
  load(request?: { readonly signal?: AbortSignal }): Promise<SnapshotRecovery | undefined>;
  commit(content: Uint8Array): Promise<VerifiedFlagSnapshot>;
}
interface SnapshotRefreshResult {
  readonly status: "updated" | "unchanged";
  readonly snapshotHash: string;
  readonly provenance?: SignedSnapshotMetadata;
}
interface SnapshotRefresher {
  refresh(request?: { readonly signal?: AbortSignal }): Promise<SnapshotRefreshResult>;
  getProvenance(): SignedSnapshotMetadata | undefined;
  close(): void;
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
  readonly schedule?: ScheduleEvaluation;
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
interface AuditPseudonym {
  readonly schemaVersion: 1;
  readonly keyId: string;
  readonly scope: string;
  readonly hash: string;
}
interface AuditPseudonymizer {
  pseudonymize(subject: string): AuditPseudonym | undefined;
}
interface HmacAuditPseudonymizerOptions {
  readonly key: Uint8Array;
  readonly keyId: string;
  readonly scope: string;
}
interface AuditEvent {
  readonly schedule?: ScheduleEvaluation;
  readonly pseudonym?: AuditPseudonym;
  readonly provenance?: SignedSnapshotMetadata;
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
  readonly pseudonymizer?: AuditPseudonymizer;
  readonly provenance?: SignedSnapshotMetadata;
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
interface AuditChainCheckpoint {
  readonly schemaVersion: 1;
  readonly chainId: string;
  readonly sequence: number;
  readonly hash: string;
}
interface ChainedAuditEvent {
  readonly schemaVersion: 1;
  readonly chainId: string;
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: AuditEvent;
  readonly hash: string;
}
interface AuditChainOptions {
  readonly maxRecordBytes?: number;
}
interface VerifyAuditChainOptions extends AuditChainOptions {
  readonly start: AuditChainCheckpoint;
  readonly expectedHead?: AuditChainCheckpoint;
  readonly maxRecords?: number;
}
interface AuditChainVerification {
  readonly records: number;
  readonly head: AuditChainCheckpoint;
  readonly checkpointMatched: boolean;
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
  readonly pendingBytes?: number;
  readonly maxQueueBytes?: number | null;
}
interface ChainedFileAuditSinkOptions {
  readonly directory: string | URL;
  onError?(error: unknown): void | Promise<void>;
  readonly chainId: string;
  readonly initialCheckpoint?: AuditChainCheckpoint;
  readonly maxSegmentBytes?: number;
  readonly maxSegments?: number;
  readonly batchSize?: number;
  readonly maxBatchBytes?: number;
  readonly maxRecordBytes?: number;
  readonly maxVerificationBytes?: number;
  readonly maxQueueSize?: number | null;
  readonly maxQueueBytes?: number | null;
  readonly lockTimeoutMs?: number;
}
interface AuditChainFileCheckpoint {
  readonly start: AuditChainCheckpoint;
  readonly head: AuditChainCheckpoint;
  readonly files: readonly string[];
}
interface ChainedFileAuditSink extends AuditSink {
  getCheckpoint(): Promise<AuditChainFileCheckpoint>;
}
interface FileAuditSinkOptions {
  readonly path: string | URL;
  readonly createDirectory?: boolean;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly lock?: boolean;
  readonly lockTimeoutMs?: number;
  /** @deprecated Automatic stale takeover is unsafe and rejected. Recover only after stopping writers. */
  readonly staleLockMs?: number;
  readonly maxQueueSize?: number | null;
  readonly maxQueueBytes?: number | null;
  readonly queueOverflowPolicy?: AuditQueueOverflowPolicy;
}
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
//#region src/audit/audit-chain.d.ts
export declare function createAuditChainCheckpoint(chainId: string): AuditChainCheckpoint;
export declare function createChainedAuditEvent(
  event: AuditEvent,
  previous: AuditChainCheckpoint,
  options?: AuditChainOptions
): ChainedAuditEvent;
export declare function verifyAuditChainRecord(
  input: unknown,
  previous: AuditChainCheckpoint,
  options?: AuditChainOptions
): AuditChainCheckpoint;
export declare function verifyAuditChain(
  records: Iterable<unknown>,
  options: VerifyAuditChainOptions
): AuditChainVerification;
//#endregion
//#region src/audit/chained-file-sink.d.ts
export declare function createChainedFileAuditSink(
  options: ChainedFileAuditSinkOptions
): ChainedFileAuditSink;
//#endregion
//#region src/audit/pseudonym.d.ts
export declare function createHmacAuditPseudonymizer(
  options: HmacAuditPseudonymizerOptions
): AuditPseudonymizer;
//#endregion
//#region src/audit/audit-sink.d.ts
export declare function createFileAuditSink(options: FileAuditSinkOptions): AuditSink;
//#endregion
//#region src/metrics/opentelemetry.d.ts
/** Uses a caller-owned Meter; never installs an SDK, exporter, timer or global provider. */
export declare function createOpenTelemetryMetrics(meter: OpenTelemetryMeter): ProviderMetrics;
//#endregion
//#region src/sources/https-source.d.ts
export declare function createHttpsSnapshotSource(
  options: HttpsSnapshotSourceOptions
): SnapshotSource;
//#endregion
//#region src/sources/s3-source.d.ts
export declare function createS3SnapshotSource(options: S3SnapshotSourceOptions): SnapshotSource;
//#endregion
//#region src/sources/snapshot-refresher.d.ts
export declare function createSnapshotRefresher(
  options: SnapshotRefresherOptions
): SnapshotRefresher;
//#endregion
//#region src/sources/snapshot-store.d.ts
export declare function createFileSnapshotStore(
  options: FileSnapshotStoreOptions
): SignedSnapshotStore;
//#endregion
//#region src/sources/signed-snapshot.d.ts
export declare function signFlagSnapshot(options: SignFlagSnapshotOptions): string;
export declare function createSnapshotVerifier(
  options: SnapshotVerificationOptions
): SnapshotVerifier;
//#endregion
export type {
  AuditChainCheckpoint,
  AuditChainFileCheckpoint,
  AuditChainOptions,
  AuditChainVerification,
  AuditContextKeyMode,
  AuditEvent,
  AuditFailurePolicy,
  AuditPseudonym,
  AuditPseudonymizer,
  AuditQueueOverflowPolicy,
  AuditRedactionOptions,
  AuditSink,
  AuditWriteMode,
  ChainedAuditEvent,
  ChainedFileAuditSink,
  ChainedFileAuditSinkOptions,
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
  FileSnapshotStoreOptions,
  FlagDefinition,
  FlagSnapshot,
  FlagSnapshotFileWatcher,
  FlagType,
  FlagValue,
  HmacAuditPseudonymizerOptions,
  HttpsSnapshotSourceOptions,
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
  S3SnapshotClient,
  S3SnapshotSourceOptions,
  ScheduleEvaluation,
  ScheduledRollout,
  SignFlagSnapshotOptions,
  SignedSnapshotMetadata,
  SignedSnapshotStore,
  SnapshotFileFormat,
  SnapshotRecovery,
  SnapshotRefreshResult,
  SnapshotRefresher,
  SnapshotRefresherOptions,
  SnapshotSource,
  SnapshotSourceRequest,
  SnapshotSourceResponse,
  SnapshotUpdateTransaction,
  SnapshotVerificationOptions,
  SnapshotVerifier,
  TargetingCondition,
  TargetingRule,
  VerifiedFlagSnapshot,
  VerifyAuditChainOptions,
  WatchFlagSnapshotFileOptions
};
//# sourceMappingURL=index.d.ts.map
