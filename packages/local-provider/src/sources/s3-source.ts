import { retainFailureCause } from "./failure-cause.js";
import { Readable } from "node:stream";
import { LocalProviderError } from "../errors/local-provider-error.js";
import type {
  S3SnapshotClient,
  S3SnapshotSourceOptions,
  SnapshotSource,
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
class S3ReadError extends LocalProviderError {
  constructor(
    message: string,
    readonly retryable = false,
    cause?: unknown
  ) {
    super("PROVIDER_NOT_READY", message);
    retainFailureCause(this, cause);
  }
}

export function createS3SnapshotSource(options: S3SnapshotSourceOptions): SnapshotSource {
  const { bucket, key } = options;
  if (typeof bucket !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,2047}$/.test(bucket))
    throw new TypeError("Snapshot bucket identifier is invalid.");
  if (
    typeof key !== "string" ||
    !key ||
    Buffer.byteLength(key) > 1024 ||
    Buffer.from(key).toString() !== key
  )
    throw new TypeError("Snapshot object key is invalid.");
  if (typeof options.client?.getObject !== "function")
    throw new TypeError("Snapshot client requires getObject.");
  const getObject = options.client.getObject.bind(options.client);
  const maxBytes = sourceInteger(
    "maxBytes",
    options.maxBytes ?? DEFAULT_SOURCE_BYTES,
    1,
    100 * 1024 * 1024
  );
  const policy = createReadPolicy(options);
  return {
    async fetch(input = {}) {
      const { etag, signal } = input;
      if (etag !== undefined && !validEtag(etag)) throw new TypeError("Snapshot ETag is invalid.");
      return readWithPolicy({
        policy,
        signal,
        read: (timeoutMs) => readAttempt(getObject, bucket, key, maxBytes, timeoutMs, etag, signal),
        retryable: (error) => error instanceof S3ReadError && error.retryable,
        cancelled: () => cancelled(signal?.reason),
        timedOut: () => new S3ReadError("S3 snapshot request timed out.", true)
      });
    }
  };
}

async function readAttempt(
  getObject: S3SnapshotClient["getObject"],
  bucket: string,
  key: string,
  maxBytes: number,
  timeoutMs: number,
  etag?: string,
  signal?: AbortSignal
): Promise<SnapshotSourceResponse> {
  const abort = new AbortController();
  let timedOut = false;
  let finished = false;
  let body: unknown;
  let iterator: AsyncIterator<unknown> | undefined;
  const close = () => {
    closeBody(body);
    try {
      void Promise.resolve(iterator?.return?.()).catch(() => {});
    } catch {
      /* Cleanup must not replace the request outcome. */
    }
  };
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    abort.abort(signal?.reason);
    close();
    rejectAbort(cancelled(signal?.reason));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
    close();
    rejectAbort(new S3ReadError("S3 snapshot request timed out.", true));
  }, timeoutMs);
  const operation = async (): Promise<SnapshotSourceResponse> => {
    const response = await getObject(
      { Bucket: bucket, Key: key, ...(etag !== undefined ? { IfNoneMatch: etag } : {}) },
      { abortSignal: abort.signal }
    );
    body = response.Body;
    if (finished || abort.signal.aborted) {
      close();
      throw cancelled();
    }
    const status = response.$metadata?.httpStatusCode ?? 200;
    if (status === 304) return notModified(etag);
    if (status !== 200)
      throw new S3ReadError(
        "S3 snapshot returned an unsuccessful status.",
        RETRYABLE_STATUS.has(status)
      );
    if (
      response.ContentEncoding !== undefined &&
      response.ContentEncoding.toLowerCase() !== "identity"
    )
      throw new S3ReadError("S3 snapshot content encoding is unsupported.");
    const length = response.ContentLength;
    if (length !== undefined && (!Number.isSafeInteger(length) || length < 0 || length > maxBytes))
      throw new S3ReadError("S3 snapshot content length is invalid or exceeds maxBytes.");
    if (body instanceof Blob) body = body.stream();
    if (body instanceof ReadableStream)
      body = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    if (!body || typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function")
      throw new S3ReadError("S3 snapshot body is unsupported.");
    iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const chunks: Buffer[] = [];
    let block: Buffer | undefined;
    let filled = 0;
    let size = 0;
    while (true) {
      const item = await iterator.next();
      if (finished || abort.signal.aborted) throw cancelled();
      if (item.done) break;
      if (!(item.value instanceof Uint8Array))
        throw new S3ReadError("S3 snapshot body must contain bytes.");
      size += item.value.byteLength;
      if (size > maxBytes) throw new S3ReadError("S3 snapshot exceeds maxBytes.");
      // Coalesce tiny chunks so bookkeeping remains bounded by bytes / block size.
      // Copy before advancing the iterator: callers may reuse their input buffer.
      let offset = 0;
      while (offset < item.value.byteLength) {
        block ??= Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes));
        const count = Math.min(block.byteLength - filled, item.value.byteLength - offset);
        block.set(item.value.subarray(offset, offset + count), filled);
        offset += count;
        filled += count;
        if (filled === block.byteLength) {
          chunks.push(block);
          block = undefined;
          filled = 0;
        }
      }
    }
    if (length !== undefined && size !== length)
      throw new S3ReadError("S3 snapshot content length does not match its body.");
    if (block) chunks.push(block.subarray(0, filled));
    return {
      status: "content",
      content: Buffer.concat(chunks, size),
      ...(response.ETag !== undefined && validEtag(response.ETag) ? { etag: response.ETag } : {})
    };
  };
  try {
    if (signal?.aborted) throw cancelled(signal.reason);
    return await Promise.race([operation(), interrupted]);
  } catch (error) {
    if (signal?.aborted) throw cancelled(signal.reason);
    if (timedOut) throw new S3ReadError("S3 snapshot request timed out.", true, error);
    if (error instanceof S3ReadError) throw error;
    const details = error as { code?: string; $metadata?: { httpStatusCode?: number } } | null;
    const status = details?.$metadata?.httpStatusCode;
    if (status === 304) return notModified(etag);
    throw new S3ReadError(
      "S3 snapshot request failed.",
      RETRYABLE_STATUS.has(status ?? 0) || TRANSIENT_CODES.has(details?.code ?? ""),
      error
    );
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    close();
  }
}

function closeBody(body: unknown): void {
  try {
    if (body instanceof Readable) {
      body.destroy();
      return;
    }
    if (body instanceof ReadableStream && !body.locked) {
      void body.cancel().catch(() => {});
      return;
    }
    // SDK and custom Node byte streams may expose destroy without inheriting Readable.
    if (body && typeof (body as { destroy?: unknown }).destroy === "function")
      (body as { destroy(): void }).destroy();
  } catch {
    /* Cleanup is best effort and must not block cancellation. */
  }
}
function notModified(etag?: string): SnapshotSourceResponse {
  if (etag === undefined) throw new S3ReadError("Unexpected S3 not-modified response.");
  return { status: "notModified" };
}
function cancelled(cause?: unknown): S3ReadError {
  return new S3ReadError("S3 snapshot request was cancelled.", false, cause);
}
