import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ResolutionDetails
} from "@openfeature/server-sdk";
import {
  createAuditEvent,
  createOverrideHash,
  createSnapshotHash,
  resolveAuditContextKeyMode
} from "../audit/audit-event.js";
import { createEnvOverrides } from "../env/env-overrides.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import { validateFlagSnapshot } from "../flags/validate-snapshot.js";
import type {
  AuditSink,
  AuditContextKeyMode,
  AuditWriteMode,
  CreateEnvOverridesOptions,
  EnvOverrideState,
  EnvSource,
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagType,
  FlagValue,
  LocalProviderOptions,
  ReloadableLocalProvider
} from "../public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import { toOpenFeatureResolution } from "./openfeature-resolution.js";

const DEFAULT_PROVIDER_NAME = "openfeature-local-provider";

export function createLocalProvider(options: LocalProviderOptions): Provider {
  return createLocalFeatureProvider(options);
}

export function createReloadableLocalProvider(
  options: LocalProviderOptions
): ReloadableLocalProvider {
  return createLocalFeatureProvider(options);
}

function createLocalFeatureProvider(options: LocalProviderOptions): LocalFeatureProvider {
  const overrideBaseOptions = {
    env: options.env ?? process.env,
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
    options.auditWriteMode ?? "nonBlocking",
    resolveAuditContextKeyMode(options.auditRedaction)
  );
}

type OverrideOptions = CreateEnvOverridesOptions & { readonly env: EnvSource };

interface ProviderState {
  readonly snapshot: FlagSnapshot;
  readonly snapshotHash: string;
  readonly overrides: EnvOverrideState;
  readonly overrideHash?: string;
}

class LocalFeatureProvider implements ReloadableLocalProvider {
  readonly metadata: { readonly name: string };
  private state: ProviderState;

  constructor(
    snapshot: FlagSnapshot,
    private readonly overrideOptions: OverrideOptions,
    name: string,
    private readonly auditSink: AuditSink | undefined,
    private readonly auditWriteMode: AuditWriteMode,
    private readonly auditContextKeyMode: AuditContextKeyMode
  ) {
    this.state = this.createState(snapshot);
    this.metadata = { name };
  }

  getSnapshot(): FlagSnapshot {
    return this.state.snapshot;
  }

  updateSnapshot(snapshot: FlagSnapshot): void {
    this.state = this.createState(snapshot);
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
    const state = this.state;
    const request = this.createEvaluationRequest(
      flagKey,
      defaultValue,
      expectedType,
      context,
      state
    );
    const result = this.evaluateSafely(request, state, logger);

    const auditWrite = this.writeAuditEvent(request, result, state, logger);

    if (this.auditWriteMode === "blocking") {
      await auditWrite;
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
    } catch {
      this.warn(logger, "openfeature-local-provider evaluation failed");

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
    return {
      flagKey,
      defaultValue,
      expectedType,
      overrides: state.overrides,
      context,
      ...(typeof context.targetingKey === "string" ? { targetingKey: context.targetingKey } : {})
    };
  }

  private async writeAuditEvent<T extends FlagValue>(
    request: EvaluationRequest<T>,
    result: EvaluationResult<T>,
    state: ProviderState,
    logger: Logger
  ): Promise<void> {
    if (this.auditSink === undefined) {
      return;
    }

    try {
      await this.auditSink.write(
        createAuditEvent({
          providerName: this.metadata.name,
          snapshot: state.snapshot,
          snapshotHash: state.snapshotHash,
          ...(state.overrideHash !== undefined ? { overrideHash: state.overrideHash } : {}),
          request,
          result,
          redaction: { contextKeys: this.auditContextKeyMode }
        })
      );
    } catch {
      this.warn(logger, "openfeature-local-provider audit sink write failed");
    }
  }

  private warn(logger: Logger, message: string): void {
    try {
      logger.warn(message);
    } catch {
      // Logging failures must not alter flag resolution.
    }
  }

  private createState(snapshot: FlagSnapshot): ProviderState {
    const validatedSnapshot = validateFlagSnapshot(snapshot);
    const overrides = createEnvOverrides(validatedSnapshot, this.overrideOptions);

    return {
      snapshot: validatedSnapshot,
      snapshotHash: createSnapshotHash(validatedSnapshot),
      overrides,
      ...(hasOverrideState(overrides) ? { overrideHash: createOverrideHash(overrides) } : {})
    };
  }
}

function hasOverrideState(overrides: EnvOverrideState): boolean {
  return (
    Object.keys(overrides.values).length > 0 ||
    Object.keys(overrides.errors).length > 0 ||
    overrides.globalError !== undefined
  );
}
