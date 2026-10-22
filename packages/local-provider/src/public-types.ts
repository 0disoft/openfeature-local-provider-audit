import type { Provider } from "@openfeature/server-sdk";
import type { KeyObject } from "node:crypto";
import type { EvaluationReason, EvaluationSource } from "./reasons.js";
import type { LocalProviderErrorCode } from "./errors/error-codes.js";

import type {
  FlagType,
  JsonValue,
  FlagValue,
  ScheduleEvaluation,
  FlagSnapshot,
  EvaluationRequest,
  EvaluationResult
} from "./core-types.js";
export type {
  FlagType,
  JsonValue,
  JsonObject,
  FlagValue,
  PercentageRolloutRule,
  FlagDefinition,
  ConditionScalar,
  ScheduledRollout,
  ScheduleEvaluation,
  TargetingCondition,
  TargetingRule,
  FlagSnapshot,
  EvaluationRequest,
  EvaluationContext,
  EvaluationResult,
  RuleExplanation,
  EvaluationExplanation,
  EnvOverrideState
} from "./core-types.js";

export interface LocalProviderOptions {
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

export interface ProviderEvaluationMetric {
  readonly requestedType: FlagType;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
  readonly durationMs: number;
}

export interface ProviderMetricsSession {
  recordEvaluation(metric: ProviderEvaluationMetric): void;
  close(): void;
}

export interface ProviderMetrics {
  bindStatus(readStatus: () => ProviderStatus, sink?: AuditSink): ProviderMetricsSession;
}

// Structural subset: consumers without telemetry need no optional module declarations.
export interface OpenTelemetryMeter {
  createCounter(
    name: string,
    options?: { unit?: string; description?: string }
  ): {
    add(value: number, attributes?: Readonly<Record<string, string>>): void;
  };
  createHistogram(
    name: string,
    options?: { unit?: string; description?: string }
  ): {
    record(value: number, attributes?: Readonly<Record<string, string>>): void;
  };
  createObservableGauge(
    name: string,
    options?: { unit?: string; description?: string }
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

export type RefreshFailureKind = "load" | "fetch" | "validation" | "signature" | "persist";

export interface ProviderAuditStatus {
  readonly enabled: boolean;
  readonly attemptedWrites: number;
  readonly resolvedWrites: number;
  readonly failedWrites: number;
  readonly timedOutWrites: number;
  readonly pendingWrites: number;
  readonly lastFailureAt?: number;
  readonly sinkStats?: FileAuditSinkStats;
}

export interface ProviderStatus {
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

export interface ObservableLocalProvider extends Provider {
  getStatus(): ProviderStatus;
  reportRefreshFailure(kind: RefreshFailureKind): void;
}

export interface ReloadableLocalProvider extends ObservableLocalProvider {
  getSnapshot(): FlagSnapshot;
  updateSnapshot(snapshot: FlagSnapshot, provenance?: SignedSnapshotMetadata): void;
  prepareSnapshot?(
    snapshot: FlagSnapshot,
    provenance?: SignedSnapshotMetadata
  ): SnapshotUpdateTransaction;
}

export interface SnapshotUpdateTransaction {
  commit(): void;
  cancel(): void;
}

export interface SnapshotSourceRequest {
  readonly etag?: string;
  readonly signal?: AbortSignal;
}

export type SnapshotSourceResponse =
  | { readonly status: "notModified" }
  | { readonly status: "content"; readonly content: Uint8Array; readonly etag?: string };

export interface SnapshotSource {
  fetch(request?: SnapshotSourceRequest): Promise<SnapshotSourceResponse>;
}

export interface HttpsSnapshotSourceOptions {
  readonly url: string | URL;
  readonly ca?: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export interface S3SnapshotClient {
  getObject(
    input: { Bucket: string; Key: string; IfNoneMatch?: string },
    options: { abortSignal: AbortSignal }
  ): Promise<{
    Body?: unknown;
    ContentLength?: number | undefined;
    ContentEncoding?: string | undefined;
    ETag?: string | undefined;
    $metadata?: { httpStatusCode?: number | undefined } | undefined;
  }>;
}

export interface S3SnapshotSourceOptions {
  readonly client: S3SnapshotClient;
  readonly bucket: string;
  readonly key: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export interface SnapshotRefresherOptions {
  readonly provider: ReloadableLocalProvider;
  readonly source: SnapshotSource;
  readonly format?: "json" | "yaml";
  readonly maxBytes?: number;
  readonly verifier?: SnapshotVerifier;
  readonly previous?: SignedSnapshotMetadata;
  readonly store?: SignedSnapshotStore;
}

export interface SignFlagSnapshotOptions {
  readonly snapshot: FlagSnapshot;
  readonly privateKey: KeyObject;
  readonly keyId: string;
  readonly audience: string;
  readonly sequence: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly maxBytes?: number;
}

export interface SnapshotVerificationOptions {
  readonly trustedKeys: Readonly<Record<string, KeyObject | string>>;
  readonly audience: string;
  readonly minSequence?: number;
  readonly maxAgeMs?: number;
  readonly maxLifetimeMs?: number;
  readonly clockSkewMs?: number;
  readonly maxBytes?: number;
}

export interface SignedSnapshotMetadata {
  readonly keyId: string;
  readonly audience: string;
  readonly sequence: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly snapshotHash: string;
  readonly artifactHash: string;
}

export interface VerifiedFlagSnapshot {
  readonly snapshot: FlagSnapshot;
  readonly provenance: SignedSnapshotMetadata;
}

export interface SnapshotVerifier {
  verify(content: Uint8Array, previous?: SignedSnapshotMetadata): VerifiedFlagSnapshot;
}

export interface FileSnapshotStoreOptions {
  readonly path: string | URL;
  readonly verification: SnapshotVerificationOptions;
  readonly maxHistory?: number;
  readonly maxBytes?: number;
  readonly createDirectory?: boolean;
}

export interface SnapshotRecovery {
  readonly floor: SignedSnapshotMetadata;
  readonly current?: VerifiedFlagSnapshot;
  readonly history: readonly VerifiedFlagSnapshot[];
}

export interface SignedSnapshotStore {
  load(): Promise<SnapshotRecovery | undefined>;
  commit(content: Uint8Array): Promise<VerifiedFlagSnapshot>;
}

export interface SnapshotRefreshResult {
  readonly status: "updated" | "unchanged";
  readonly snapshotHash: string;
  readonly provenance?: SignedSnapshotMetadata;
}

export interface SnapshotRefresher {
  refresh(request?: { readonly signal?: AbortSignal }): Promise<SnapshotRefreshResult>;
  getProvenance(): SignedSnapshotMetadata | undefined;
  close(): void;
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
  readonly consistencyPollIntervalMs?: number;
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

export type AuditFailurePolicy = "bestEffort" | "returnDefault";

export type AuditContextKeyMode = "names" | "count" | "none";

export interface AuditRedactionOptions {
  readonly contextKeys?: AuditContextKeyMode;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

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
  readonly schedule?: ScheduleEvaluation;
  readonly value: T;
  readonly variant?: string;
  readonly ruleId?: string;
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

export interface AuditPseudonym {
  readonly schemaVersion: 1;
  readonly keyId: string;
  readonly scope: string;
  readonly hash: string;
}

export interface AuditPseudonymizer {
  pseudonymize(subject: string): AuditPseudonym | undefined;
}

export interface HmacAuditPseudonymizerOptions {
  readonly key: Uint8Array;
  readonly keyId: string;
  readonly scope: string;
}

export interface AuditEvent {
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

export interface RedactedAuditContext {
  readonly targetingKeyPresent: boolean;
  readonly keyMode?: AuditContextKeyMode;
  readonly keys: readonly string[];
  readonly keyCount?: number;
  readonly redacted: true;
}

export interface CreateAuditEventOptions {
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

export interface AuditChainCheckpoint {
  readonly schemaVersion: 1;
  readonly chainId: string;
  readonly sequence: number;
  readonly hash: string;
}

export interface ChainedAuditEvent {
  readonly schemaVersion: 1;
  readonly chainId: string;
  readonly sequence: number;
  readonly previousHash: string;
  readonly event: AuditEvent;
  readonly hash: string;
}

export interface AuditChainOptions {
  readonly maxRecordBytes?: number;
}

export interface VerifyAuditChainOptions extends AuditChainOptions {
  readonly start: AuditChainCheckpoint;
  readonly expectedHead?: AuditChainCheckpoint;
  readonly maxRecords?: number;
}

export interface AuditChainVerification {
  readonly records: number;
  readonly head: AuditChainCheckpoint;
  readonly checkpointMatched: boolean;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  writeConfirmed?(event: AuditEvent): Promise<void>;
  flush?(): Promise<void>;
  getStats?(): FileAuditSinkStats;
}

export type AuditQueueOverflowPolicy = "reject" | "dropNewest";

export interface FileAuditSinkStats {
  readonly pendingWrites: number;
  readonly droppedWrites: number;
  readonly rejectedWrites: number;
  readonly maxQueueSize: number | null;
}

export interface ChainedFileAuditSinkOptions {
  readonly directory: string | URL;
  readonly chainId: string;
  readonly initialCheckpoint?: AuditChainCheckpoint;
  readonly maxSegmentBytes?: number;
  readonly maxSegments?: number;
  readonly maxRecordBytes?: number;
  readonly maxVerificationBytes?: number;
  readonly maxQueueSize?: number | null;
  readonly lockTimeoutMs?: number;
}

export interface AuditChainFileCheckpoint {
  readonly start: AuditChainCheckpoint;
  readonly head: AuditChainCheckpoint;
  readonly files: readonly string[];
}

export interface ChainedFileAuditSink extends AuditSink {
  getCheckpoint(): Promise<AuditChainFileCheckpoint>;
}

export interface FileAuditSinkOptions {
  readonly path: string | URL;
  readonly createDirectory?: boolean;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly lock?: boolean;
  readonly lockTimeoutMs?: number;
  /** @deprecated Automatic stale takeover is unsafe and rejected. Recover only after stopping writers. */
  readonly staleLockMs?: number;
  readonly maxQueueSize?: number | null;
  readonly queueOverflowPolicy?: AuditQueueOverflowPolicy;
}
