import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ResolutionDetails
} from "@openfeature/server-sdk";
import { evaluateFlag } from "../evaluator/evaluate.js";
import type { FlagSnapshot, LocalProviderOptions } from "../public-types.js";
import { toOpenFeatureResolution } from "./openfeature-resolution.js";

const DEFAULT_PROVIDER_NAME = "openfeature-local-provider";

export function createLocalProvider(options: LocalProviderOptions): Provider {
  return new LocalFeatureProvider(options.snapshot, options.name ?? DEFAULT_PROVIDER_NAME);
}

class LocalFeatureProvider implements Provider {
  readonly metadata: { readonly name: string };

  constructor(
    private readonly snapshot: FlagSnapshot,
    name: string
  ) {
    this.metadata = { name };
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<boolean>> {
    return toOpenFeatureResolution(
      evaluateFlag(this.snapshot, { flagKey, defaultValue, expectedType: "boolean" })
    );
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    _context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<string>> {
    return toOpenFeatureResolution(
      evaluateFlag(this.snapshot, { flagKey, defaultValue, expectedType: "string" })
    );
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    _context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<number>> {
    return toOpenFeatureResolution(
      evaluateFlag(this.snapshot, { flagKey, defaultValue, expectedType: "number" })
    );
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
    _logger: Logger
  ): Promise<ResolutionDetails<T>> {
    return toOpenFeatureResolution(
      evaluateFlag(this.snapshot, { flagKey, defaultValue, expectedType: "object" })
    ) as ResolutionDetails<T>;
  }
}
