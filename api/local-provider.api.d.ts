import { Provider } from "@openfeature/server-sdk";

declare const LOCAL_PROVIDER_ERROR_CODES: {
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

declare class LocalProviderError extends Error {
  readonly code: LocalProviderErrorCode;
  constructor(code: LocalProviderErrorCode, message: string);
}
declare function isLocalProviderError(value: unknown): value is LocalProviderError;

declare const EVALUATION_REASONS: {
  readonly STATIC: "STATIC";
  readonly DEFAULT: "DEFAULT";
  readonly ENV_OVERRIDE: "ENV_OVERRIDE";
  readonly SPLIT: "SPLIT";
  readonly ERROR: "ERROR";
};
type EvaluationReason = (typeof EVALUATION_REASONS)[keyof typeof EVALUATION_REASONS];
declare const EVALUATION_SOURCES: {
  readonly FILE: "file";
  readonly ENV: "env";
  readonly DEFAULT: "default";
  readonly ERROR: "error";
};
type EvaluationSource = (typeof EVALUATION_SOURCES)[keyof typeof EVALUATION_SOURCES];

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
}
interface FlagSnapshot {
  readonly schemaVersion: 1;
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
  readonly bucket?: number;
  readonly reason: EvaluationReason;
  readonly source: EvaluationSource;
  readonly errorCode?: LocalProviderErrorCode;
  readonly errorMessage?: string;
  readonly flagMetadata: Readonly<Record<string, string | number | boolean>>;
}
interface LocalProviderOptions {
  readonly snapshot: FlagSnapshot;
  readonly name?: string;
  readonly overridesJson?: string;
  readonly maxOverridesJsonBytes?: number;
  readonly env?: EnvSource;
  readonly auditSink?: AuditSink;
  readonly auditWriteMode?: AuditWriteMode;
  readonly auditRedaction?: AuditRedactionOptions;
}
interface ReloadableLocalProvider extends Provider {
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

declare function parseJsonFlagSnapshot(json: string): FlagSnapshot;

declare function parseYamlFlagSnapshot(yaml: string): FlagSnapshot;

declare function loadFlagSnapshotFile(
  path: string | URL,
  options?: LoadFlagSnapshotFileOptions
): Promise<FlagSnapshot>;
declare function watchFlagSnapshotFile(
  options: WatchFlagSnapshotFileOptions
): Promise<FlagSnapshotFileWatcher>;

declare function createEnvOverrides(
  snapshot: FlagSnapshot,
  options?: CreateEnvOverridesOptions
): EnvOverrideState;

declare function evaluateFlag<T extends FlagValue>(
  snapshot: FlagSnapshot,
  request: EvaluationRequest<T>
): EvaluationResult<T>;

declare function createLocalProvider(options: LocalProviderOptions): Provider;
declare function createReloadableLocalProvider(
  options: LocalProviderOptions
): ReloadableLocalProvider;

declare function replayEvaluationFixture<T extends FlagValue>(
  fixture: ReplayFixture<T>
): ReplayResult<T>;

declare function createAuditEvent(options: CreateAuditEventOptions): AuditEvent;
declare function serializeAuditEvent(event: AuditEvent): string;
declare function redactContext(
  context?: EvaluationContext,
  options?: AuditRedactionOptions
): RedactedAuditContext;

declare function createFileAuditSink(options: FileAuditSinkOptions): AuditSink;

export {
  type AuditContextKeyMode,
  type AuditEvent,
  type AuditQueueOverflowPolicy,
  type AuditRedactionOptions,
  type AuditSink,
  type AuditWriteMode,
  type CreateAuditEventOptions,
  type CreateEnvOverridesOptions,
  EVALUATION_REASONS,
  EVALUATION_SOURCES,
  type EnvOverrideState,
  type EnvSource,
  type EvaluationContext,
  type EvaluationReason,
  type EvaluationRequest,
  type EvaluationResult,
  type EvaluationSource,
  type FileAuditSinkOptions,
  type FileAuditSinkStats,
  type FlagDefinition,
  type FlagSnapshot,
  type FlagSnapshotFileWatcher,
  type FlagType,
  type FlagValue,
  type JsonObject,
  type JsonValue,
  LOCAL_PROVIDER_ERROR_CODES,
  type LoadFlagSnapshotFileOptions,
  LocalProviderError,
  type LocalProviderErrorCode,
  type LocalProviderOptions,
  type PercentageRolloutRule,
  type RedactedAuditContext,
  type ReloadableLocalProvider,
  type ReplayExpectedResult,
  type ReplayFixture,
  type ReplayMismatch,
  type ReplayOverrideInput,
  type ReplayResult,
  type SnapshotFileFormat,
  type WatchFlagSnapshotFileOptions,
  createAuditEvent,
  createEnvOverrides,
  createFileAuditSink,
  createLocalProvider,
  createReloadableLocalProvider,
  evaluateFlag,
  isLocalProviderError,
  loadFlagSnapshotFile,
  parseJsonFlagSnapshot,
  parseYamlFlagSnapshot,
  redactContext,
  replayEvaluationFixture,
  serializeAuditEvent,
  watchFlagSnapshotFile
};
