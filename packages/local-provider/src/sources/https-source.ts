import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type {
  HttpsSnapshotSourceOptions,
  SnapshotSource,
  SnapshotSourceRequest,
  SnapshotSourceResponse
} from "../public-types.js";

export const DEFAULT_SOURCE_BYTES = 10 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE"
]);

class HttpsReadError extends LocalProviderError {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super("PROVIDER_NOT_READY", message);
  }
}

export function createHttpsSnapshotSource(options: HttpsSnapshotSourceOptions): SnapshotSource {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new TypeError("Snapshot source URL must be an absolute HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 8_192
  ) {
    throw new TypeError("Snapshot source requires HTTPS without URL credentials or fragments.");
  }
  const maxBytes = sourceInteger(
    "maxBytes",
    options.maxBytes ?? DEFAULT_SOURCE_BYTES,
    1,
    100 * 1024 * 1024
  );
  const timeoutMs = sourceInteger("timeoutMs", options.timeoutMs ?? 5_000, 1, 60_000);
  const maxAttempts = sourceInteger("maxAttempts", options.maxAttempts ?? 3, 1, 5);
  const retryDelayMs = sourceInteger("retryDelayMs", options.retryDelayMs ?? 100, 0, 5_000);
  const ca = options.ca;
  return {
    async fetch(input: SnapshotSourceRequest = {}): Promise<SnapshotSourceResponse> {
      const etag = input.etag;
      const signal = input.signal;
      if (etag !== undefined && !validEtag(etag)) {
        throw new TypeError("Snapshot ETag is invalid.");
      }
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw cancelled();
        try {
          return await readAttempt(url, ca, maxBytes, timeoutMs, etag, signal);
        } catch (error) {
          if (signal?.aborted) throw cancelled();
          if (
            !(error instanceof HttpsReadError) ||
            !error.retryable ||
            attempt + 1 >= maxAttempts
          ) {
            throw error;
          }
          try {
            await delay(Math.min(5_000, retryDelayMs * 2 ** attempt), undefined, { signal });
          } catch {
            throw cancelled();
          }
        }
      }
    }
  };
}

async function readAttempt(
  url: URL,
  ca: string | undefined,
  maxBytes: number,
  timeoutMs: number,
  etag: string | undefined,
  signal: AbortSignal | undefined
): Promise<SnapshotSourceResponse> {
  const abort = new AbortController();
  let timedOut = false;
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timeoutMs);
  try {
    if (signal?.aborted) throw cancelled();
    return await new Promise<SnapshotSourceResponse>((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: "GET",
          agent: false,
          signal: abort.signal,
          maxHeaderSize: 16 * 1024,
          ...(ca !== undefined ? { ca } : {}),
          headers: {
            accept: "application/jose, application/json, application/yaml, text/yaml",
            "accept-encoding": "identity",
            ...(etag !== undefined ? { "if-none-match": etag } : {})
          }
        },
        (response) => {
          void readResponse(response, maxBytes, etag !== undefined).then(resolve, reject);
        }
      );
      request.once("error", reject);
      request.end();
    });
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (timedOut) throw new HttpsReadError("HTTPS snapshot request timed out.", true);
    if (error instanceof HttpsReadError) throw error;
    const code = (error as { code?: string } | null)?.code;
    throw new HttpsReadError(
      "HTTPS snapshot request failed.",
      code !== undefined && TRANSIENT_CODES.has(code)
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readResponse(
  response: IncomingMessage,
  maxBytes: number,
  conditional: boolean
): Promise<SnapshotSourceResponse> {
  try {
    const status = response.statusCode;
    if (status === 304) {
      if (!conditional) throw new HttpsReadError("Unexpected HTTPS not-modified response.");
      return { status: "notModified" };
    }
    if (status !== 200) {
      throw new HttpsReadError(
        "HTTPS snapshot returned an unsuccessful status.",
        RETRYABLE_STATUS.has(status ?? 0)
      );
    }
    const encoding = response.headers["content-encoding"];
    if (encoding !== undefined && encoding.toLowerCase() !== "identity") {
      throw new HttpsReadError("HTTPS snapshot content encoding is unsupported.");
    }
    const length = response.headers["content-length"];
    if (length !== undefined && Number(length) > maxBytes) {
      throw new HttpsReadError("HTTPS snapshot exceeds maxBytes.");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      const bytes = chunk as Buffer;
      size += bytes.byteLength;
      if (size > maxBytes) throw new HttpsReadError("HTTPS snapshot exceeds maxBytes.");
      chunks.push(bytes);
    }
    const etag = response.headers.etag;
    return {
      status: "content",
      content: Buffer.concat(chunks, size),
      ...(etag !== undefined && validEtag(etag) ? { etag } : {})
    };
  } finally {
    // Also closes redirect/error/oversized streams without retaining their bodies.
    response.destroy();
  }
}

export function sourceInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function validEtag(value: string): boolean {
  return value.length <= 1_024 && /^(W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

function cancelled(): HttpsReadError {
  return new HttpsReadError("HTTPS snapshot request was cancelled.");
}
