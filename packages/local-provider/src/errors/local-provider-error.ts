import type { LocalProviderErrorCode } from "./error-codes.js";

export class LocalProviderError extends Error {
  readonly code: LocalProviderErrorCode;

  constructor(code: LocalProviderErrorCode, message: string) {
    super(message);
    this.name = "LocalProviderError";
    this.code = code;
  }
}

export function isLocalProviderError(value: unknown): value is LocalProviderError {
  return value instanceof LocalProviderError;
}
