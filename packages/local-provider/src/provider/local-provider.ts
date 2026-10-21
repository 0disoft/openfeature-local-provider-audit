import type {
  EvaluationContext,
  JsonValue,
  Logger,
  ResolutionDetails
} from "@openfeature/server-sdk";
import { OpenFeatureEventEmitter, ProviderEvents } from "@openfeature/server-sdk";
import {
  createAuditEvent,
  createOverrideHash,
  createSnapshotHash,
  resolveAuditContextKeyMode
} from "../audit/audit-event.js";
import { createEnvOverrides } from "../env/env-overrides.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import { captureSnapshotProvenance } from "../flags/snapshot-provenance.js";
import { validateFlagSnapshot } from "../flags/validate-snapshot.js";
import type {
  AuditSink,
  AuditPseudonymizer,
  AuditContextKeyMode,
  CreateEnvOverridesOptions,
  EnvOverrideState,
  EnvSource,
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagType,
  FlagValue,
  LocalProviderOptions,
  ObservableLocalProvider,
  ProviderStatus,
  ProviderMetrics,
  ProviderMetricsSession,
  RefreshFailureKind,
  ReloadableLocalProvider,
  SignedSnapshotMetadata,
  SnapshotUpdateTransaction
} from "../public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import { toOpenFeatureResolution } from "./openfeature-resolution.js";
import { OperationalState } from "./operational-state.js";
import { resolveAuditPolicy, waitForAudit, type AuditPolicy } from "./audit-policy.js";

const DEFAULT_PROVIDER_NAME = "openfeature-local-provider";

export function createLocalProvider(options: LocalProviderOptions): ObservableLocalProvider {
  return createLocalFeatureProvider(options);
}

export function createReloadableLocalProvider(
  options: LocalProviderOptions
): ReloadableLocalProvider {
  return createLocalFeatureProvider(options);
}

function createLocalFeatureProvider(options: LocalProviderOptions): LocalFeatureProvider {
  if (
    options.auditPseudonymizer !== undefined &&
    typeof options.auditPseudonymizer.pseudonymize !== "function"
  )
    throw new TypeError("auditPseudonymizer must expose pseudonymize.");
  const overrideBaseOptions = {
    env: captureEnv(options.env ?? process.env),
    ...(options.maxOverridesJsonBytes !== undefined
      ? { maxOverridesJsonBytes: options.maxOverridesJsonBytes }
      : {})
  };
  const overrideOptions =
    options.overridesJson === undefined
      ? overrideBaseOptions
      : {
          ...overrideBaseOptions,
          overridesJson: options.overridesJson
        };

  return new LocalFeatureProvider(
    options.snapshot,
    overrideOptions,
    options.name ?? DEFAULT_PROVIDER_NAME,
    options.auditSink,
    resolveAuditPolicy(options),
    resolveAuditContextKeyMode(options.auditRedaction),
    options.staleAfterMs,
    options.metrics,
    options.provenance,
    options.auditPseudonymizer
  );
}

function captureEnv(env: EnvSource): EnvSource {
  const captured: Record<string, string | undefined> = Object.create(null);
  for (const [key, value] of Object.entries(env)) {
    Object.defineProperty(captured, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false
    });
  }
  return Object.freeze(captured);
}

type OverrideOptions = CreateEnvOverridesOptions & { readonly env: EnvSource };

interface ProviderState {
  readonly provenance: SignedSnapshotMetadata | undefined;
  readonly snapshot: FlagSnapshot;
  readonly snapshotHash: string;
  readonly overrides: EnvOverrideState;
  readonly overrideHash?: string;
  readonly flagHashes: ReadonlyMap<string, string>;
}

class LocalFeatureProvider implements ReloadableLocalProvider {
  readonly metadata: { readonly name: string };
  readonly events = new OpenFeatureEventEmitter();
  private state: ProviderState;
  private closed = false;
  private pendingUpdate: object | undefined;
  private readonly operational: OperationalState;
  private readonly metricsSession: ProviderMetricsSession | undefined;

  constructor(
    snapshot: FlagSnapshot,
    private readonly overrideOptions: OverrideOptions,
    name: string,
    private readonly auditSink: AuditSink | undefined,
    private readonly auditPolicy: AuditPolicy,
    private readonly auditContextKeyMode: AuditContextKeyMode,
    staleAfterMs: number | undefined,
    metrics: ProviderMetrics | undefined,
    provenance: SignedSnapshotMetadata | undefined,
    private readonly auditPseudonymizer: AuditPseudonymizer | undefined
  ) {
    this.operational = new OperationalState(staleAfterMs);
    this.state = this.createState(snapshot, provenance);
    this.metadata = { name };
    try {
      this.metricsSession = metrics?.bindStatus(() => this.getStatus(), this.auditSink);
    } catch {
      // Diagnostics failures do not prevent provider registration.
      this.metricsSession = undefined;
    }
  }

  getSnapshot(): FlagSnapshot {
    return this.state.snapshot;
  }

  getStatus(): ProviderStatus {
    return this.operational.read(
      this.state.snapshotHash,
      this.closed,
      this.auditSink,
      this.state.provenance
    );
  }

  reportRefreshFailure(kind: RefreshFailureKind): void {
    this.operational.refreshFailed(kind);
  }

  updateSnapshot(snapshot: FlagSnapshot, provenance?: SignedSnapshotMetadata): void {
    this.assertUpdateAvailable();
    this.applyState(this.buildNextState(snapshot, provenance));
  }

  prepareSnapshot(
    snapshot: FlagSnapshot,
    provenance?: SignedSnapshotMetadata
  ): SnapshotUpdateTransaction {
    this.assertUpdateAvailable();
    if (this.closed) throw new LocalProviderError("PROVIDER_NOT_READY", "Provider is closed.");
    const next = this.buildNextState(snapshot, provenance);
    const reservation = {};
    this.pendingUpdate = reservation;
    return Object.freeze({
      commit: () => {
        if (this.pendingUpdate !== reservation || this.closed)
          throw new LocalProviderError(
            "PROVIDER_NOT_READY",
            "Snapshot transaction is no longer active."
          );
        this.pendingUpdate = undefined;
        this.applyState(next);
      },
      cancel: () => {
        if (this.pendingUpdate === reservation) this.pendingUpdate = undefined;
      }
    });
  }

  private assertUpdateAvailable(): void {
    if (this.pendingUpdate !== undefined) {
      this.operational.refreshFailed("load");
      throw new LocalProviderError(
        "PROVIDER_NOT_READY",
        "A snapshot update is pending persistence."
      );
    }
  }

  private buildNextState(
    snapshot: FlagSnapshot,
    provenance?: SignedSnapshotMetadata
  ): ProviderState {
    try {
      return this.createState(snapshot, provenance);
    } catch (error) {
      this.operational.refreshFailed("validation");
      throw error;
    }
  }

  private applyState(nextState: ProviderState): void {
    const previousState = this.state;
    this.operational.refreshed(nextState.snapshotHash !== previousState.snapshotHash);
    if (nextState.snapshotHash === previousState.snapshotHash) {
      this.state = { ...previousState, provenance: nextState.provenance };
      return;
    }
    this.state = nextState;
    if (!this.closed) {
      this.events.emit(ProviderEvents.ConfigurationChanged, {
        flagsChanged: findChangedFlagKeys(previousState.flagHashes, nextState.flagHashes)
      });
    }
  }

  async onClose(): Promise<void> {
    this.closed = true;
    try {
      await this.auditSink?.flush?.();
    } finally {
      this.events.removeAllHandlers();
      try {
        this.metricsSession?.close();
      } catch {
        // Preserve the original flush result.
      }
    }
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<boolean>> {
    return this.evaluateAndResolve(flagKey, defaultValue, "boolean", context, logger);
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<string>> {
    return this.evaluateAndResolve(flagKey, defaultValue, "string", context, logger);
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<number>> {
    return this.evaluateAndResolve(flagKey, defaultValue, "number", context, logger);
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<T>> {
    return this.evaluateAndResolve(flagKey, defaultValue, "object", context, logger);
  }

  private async evaluateAndResolve<T extends FlagValue>(
    flagKey: string,
    defaultValue: T,
    expectedType: FlagType,
    context: EvaluationContext,
    logger: Logger
  ): Promise<ResolutionDetails<T>> {
    const startedAt = this.metricsSession === undefined ? undefined : performance.now();
    const state = this.state;
    const request = this.createEvaluationRequest(
      flagKey,
      defaultValue,
      expectedType,
      context,
      state
    );
    let result = this.evaluateSafely(request, state, logger);

    const auditWrite = this.writeAuditEvent(request, result, state, logger);

    if (this.auditPolicy.writeMode === "blocking") {
      const confirmed = await waitForAudit(auditWrite, this.auditPolicy.timeoutMs, () => {
        this.operational.auditTimedOut();
      });
      if (!confirmed && this.auditPolicy.failurePolicy === "returnDefault") {
        result = {
          flagKey,
          value: defaultValue,
          reason: EVALUATION_REASONS.ERROR,
          source: EVALUATION_SOURCES.ERROR,
          errorCode: LOCAL_PROVIDER_ERROR_CODES.AUDIT_SINK_ERROR,
          errorMessage: "Audit confirmation failed or timed out.",
          flagMetadata: {}
        };
      }
    }

    if (startedAt !== undefined) {
      try {
        this.metricsSession?.recordEvaluation({
          requestedType: expectedType,
          reason: result.reason,
          source: result.source,
          ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
          durationMs: Math.max(0, performance.now() - startedAt)
        });
      } catch {
        // Metrics are optional and must not change the resolution.
      }
    }
    return toOpenFeatureResolution(result) as ResolutionDetails<T>;
  }

  private evaluateSafely<T extends FlagValue>(
    request: EvaluationRequest<T>,
    state: ProviderState,
    logger: Logger
  ): EvaluationResult<T> {
    try {
      return evaluateFlag(state.snapshot, request);
    } catch (error) {
      this.warn(logger, "openfeature-local-provider evaluation failed", error);

      return {
        flagKey: request.flagKey,
        value: request.defaultValue,
        reason: EVALUATION_REASONS.ERROR,
        source: EVALUATION_SOURCES.ERROR,
        errorCode: LOCAL_PROVIDER_ERROR_CODES.PROVIDER_NOT_READY,
        errorMessage: "Provider evaluation failed.",
        flagMetadata: {}
      };
    }
  }

  private createEvaluationRequest<T extends FlagValue>(
    flagKey: string,
    defaultValue: T,
    expectedType: FlagType,
    context: EvaluationContext,
    state: ProviderState
  ): EvaluationRequest<T> {
    const descriptor = Object.getOwnPropertyDescriptor(context, "targetingKey");
    const targetingKey =
      descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
    return {
      flagKey,
      defaultValue,
      expectedType,
      overrides: state.overrides,
      context,
      ...(typeof targetingKey === "string" ? { targetingKey } : {})
    } as EvaluationRequest<T>;
  }

  private async writeAuditEvent<T extends FlagValue>(
    request: EvaluationRequest<T>,
    result: EvaluationResult<T>,
    state: ProviderState,
    logger: Logger
  ): Promise<boolean> {
    if (this.auditSink === undefined) {
      return true;
    }

    this.operational.auditStarted();
    let failed = false;
    try {
      const event = createAuditEvent({
        ...(this.auditPseudonymizer !== undefined
          ? { pseudonymizer: this.auditPseudonymizer }
          : {}),
        providerName: this.metadata.name,
        snapshot: state.snapshot,
        snapshotHash: state.snapshotHash,
        ...(state.provenance !== undefined ? { provenance: state.provenance } : {}),
        ...(state.overrideHash !== undefined ? { overrideHash: state.overrideHash } : {}),
        request,
        result,
        redaction: { contextKeys: this.auditContextKeyMode }
      });
      if (this.auditPolicy.failurePolicy === "returnDefault") {
        // Validated at construction; keep the receiver for stateful custom sinks.
        if (this.auditSink.writeConfirmed === undefined) {
          throw new Error("Audit confirmation is unavailable.");
        }
        await this.auditSink.writeConfirmed(event);
      } else {
        await this.auditSink.write(event);
      }
      return true;
    } catch (error) {
      failed = true;
      this.warn(logger, "openfeature-local-provider audit sink write failed", error);
      return false;
    } finally {
      this.operational.auditFinished(failed);
    }
  }

  private warn(logger: Logger, message: string, cause: unknown): void {
    try {
      logger.warn(message, cause);
    } catch {
      // Logging failures must not alter flag resolution.
    }
  }

  private createState(snapshot: FlagSnapshot, provenance?: SignedSnapshotMetadata): ProviderState {
    const validatedSnapshot = validateFlagSnapshot(snapshot);
    const overrides = createEnvOverrides(validatedSnapshot, this.overrideOptions);
    const snapshotHash = createSnapshotHash(validatedSnapshot);

    return {
      snapshot: validatedSnapshot,
      snapshotHash,
      provenance: captureSnapshotProvenance(provenance, snapshotHash),
      overrides,
      flagHashes: createFlagHashes(validatedSnapshot),
      ...(hasOverrideState(overrides) ? { overrideHash: createOverrideHash(overrides) } : {})
    };
  }
}

function createFlagHashes(snapshot: FlagSnapshot): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(snapshot.flags).map(([flagKey, flag]) => [
      flagKey,
      createSnapshotHash({ schemaVersion: snapshot.schemaVersion, flags: { [flagKey]: flag } })
    ])
  );
}

function findChangedFlagKeys(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>
): string[] {
  return [...new Set([...previous.keys(), ...next.keys()])]
    .filter((flagKey) => previous.get(flagKey) !== next.get(flagKey))
    .sort(compareCodeUnits);
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function hasOverrideState(overrides: EnvOverrideState): boolean {
  return (
    Object.keys(overrides.values).length > 0 ||
    Object.keys(overrides.errors).length > 0 ||
    overrides.globalError !== undefined
  );
}
