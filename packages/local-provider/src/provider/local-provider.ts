import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ResolutionDetails
} from "@openfeature/server-sdk";
import { createAuditEvent } from "../audit/audit-event.js";
import { createEnvOverrides } from "../env/env-overrides.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import type {
  AuditSink,
  EnvOverrideState,
  EvaluationRequest,
  EvaluationResult,
  FlagSnapshot,
  FlagType,
  FlagValue,
  LocalProviderOptions
} from "../public-types.js";
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
    options.auditSink
  );
}

class LocalFeatureProvider implements Provider {
  readonly metadata: { readonly name: string };

  constructor(
    private readonly snapshot: FlagSnapshot,
    private readonly overrides: EnvOverrideState,
    name: string,
    private readonly auditSink: AuditSink | undefined
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
    const result = evaluateFlag(this.snapshot, request);

    await this.writeAuditEvent(request, result, logger);

    return toOpenFeatureResolution(result) as ResolutionDetails<T>;
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
      try {
        logger.warn("openfeature-local-provider audit sink write failed");
      } catch {
        // Audit logging must not alter flag resolution, including logger failures.
      }
    }
  }
}
