import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ResolutionDetails
} from "@openfeature/server-sdk";
import { createAuditEvent } from "../audit/audit-event.js";
import { createEnvOverrides } from "../env/env-overrides.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import type {
  AuditSink,
  AuditWriteMode,
  EnvOverrideState,
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagType,
  FlagValue,
  LocalProviderOptions
} from "../public-types.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import { toOpenFeatureResolution } from "./openfeature-resolution.js";

const DEFAULT_PROVIDER_NAME = "openfeature-local-provider";

export function createLocalProvider(options: LocalProviderOptions): Provider {
  const overrideOptions =
    options.overridesJson === undefined
      ? { env: options.env ?? process.env }
      : {
          overridesJson: options.overridesJson,
          env: options.env ?? process.env
        };

  return new LocalFeatureProvider(
    options.snapshot,
    createEnvOverrides(options.snapshot, overrideOptions),
    options.name ?? DEFAULT_PROVIDER_NAME,
    options.auditSink,
    options.auditWriteMode ?? "nonBlocking"
  );
}

class LocalFeatureProvider implements Provider {
  readonly metadata: { readonly name: string };

  constructor(
    private readonly snapshot: FlagSnapshot,
    private readonly overrides: EnvOverrideState,
    name: string,
    private readonly auditSink: AuditSink | undefined,
    private readonly auditWriteMode: AuditWriteMode
  ) {
    this.metadata = { name };
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
    const request = this.createEvaluationRequest(flagKey, defaultValue, expectedType, context);
    const result = this.evaluateSafely(request, logger);

    const auditWrite = this.writeAuditEvent(request, result, logger);

    if (this.auditWriteMode === "blocking") {
      await auditWrite;
    }

    return toOpenFeatureResolution(result) as ResolutionDetails<T>;
  }

  private evaluateSafely<T extends FlagValue>(
    request: EvaluationRequest<T>,
    logger: Logger
  ): EvaluationResult<T> {
    try {
      return evaluateFlag(this.snapshot, request);
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
    context: EvaluationContext
  ): EvaluationRequest<T> {
    return {
      flagKey,
      defaultValue,
      expectedType,
      overrides: this.overrides,
      context,
      ...(typeof context.targetingKey === "string" ? { targetingKey: context.targetingKey } : {})
    };
  }

  private async writeAuditEvent<T extends FlagValue>(
    request: EvaluationRequest<T>,
    result: EvaluationResult<T>,
    logger: Logger
  ): Promise<void> {
    if (this.auditSink === undefined) {
      return;
    }

    try {
      await this.auditSink.write(
        createAuditEvent({
          providerName: this.metadata.name,
          snapshot: this.snapshot,
          request,
          result
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
}
