import { retainFailureCause } from "./failure-cause.js";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type {
  HttpsSnapshotSourceOptions,
  SnapshotSource,
  SnapshotSourceRequest,
  SnapshotSourceResponse
} from "../public-types.js";

import {
  DEFAULT_SOURCE_BYTES,
  sourceInteger,
  validEtag,
  createReadPolicy,
  readWithPolicy
} from "./source-policy.js";
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
    readonly retryable = false,
    cause?: unknown
  ) {
    super("PROVIDER_NOT_READY", message);
    retainFailureCause(this, cause);
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
  const policy = createReadPolicy(options);
  const ca = options.ca;
  return {
    async fetch(input: SnapshotSourceRequest = {}): Promise<SnapshotSourceResponse> {
      const etag = input.etag;
      const signal = input.signal;
      if (etag !== undefined && !validEtag(etag)) {
        throw new TypeError("Snapshot ETag is invalid.");
      }
      return readWithPolicy({
        policy,
        signal,
        read: (timeoutMs) => readAttempt(url, ca, maxBytes, timeoutMs, etag, signal),
        retryable: (error) => error instanceof HttpsReadError && error.retryable,
        cancelled: () => cancelled(signal?.reason),
        timedOut: () => new HttpsReadError("HTTPS snapshot request timed out.", true)
      });
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
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timeoutMs);
  try {
    if (signal?.aborted) throw cancelled(signal.reason);
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
    if (signal?.aborted) throw cancelled(signal.reason);
    if (timedOut) throw new HttpsReadError("HTTPS snapshot request timed out.", true, error);
    if (error instanceof HttpsReadError) throw error;
    const code = (error as { code?: string } | null)?.code;
    throw new HttpsReadError(
      "HTTPS snapshot request failed.",
      code !== undefined && TRANSIENT_CODES.has(code),
      error
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

function cancelled(cause?: unknown): HttpsReadError {
  return new HttpsReadError("HTTPS snapshot request was cancelled.", false, cause);
}
