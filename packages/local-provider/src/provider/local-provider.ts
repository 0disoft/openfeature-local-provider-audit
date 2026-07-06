import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ResolutionDetails
} from "@openfeature/server-sdk";
import { createEnvOverrides } from "../env/env-overrides.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import type {
  EnvOverrideState,
  EvaluationRequest,
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
    options.name ?? DEFAULT_PROVIDER_NAME
  );
}

class LocalFeatureProvider implements Provider {
  readonly metadata: { readonly name: string };

  constructor(
    private readonly snapshot: FlagSnapshot,
    private readonly overrides: EnvOverrideState,
    name: string
  ) {
    this.metadata = { name };
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<boolean>> {
    return toOpenFeatureResolution(
      evaluateFlag(
        this.snapshot,
        this.createEvaluationRequest(flagKey, defaultValue, "boolean", context)
      )
    );
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<string>> {
    return toOpenFeatureResolution(
      evaluateFlag(
        this.snapshot,
        this.createEvaluationRequest(flagKey, defaultValue, "string", context)
      )
    );
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<number>> {
    return toOpenFeatureResolution(
      evaluateFlag(
        this.snapshot,
        this.createEvaluationRequest(flagKey, defaultValue, "number", context)
      )
    );
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<T>> {
    return toOpenFeatureResolution(
      evaluateFlag(
        this.snapshot,
        this.createEvaluationRequest(flagKey, defaultValue, "object", context)
      )
    ) as ResolutionDetails<T>;
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
}
