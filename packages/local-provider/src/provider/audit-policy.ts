import type {
  AuditFailurePolicy,
  AuditSink,
  AuditWriteMode,
  LocalProviderOptions
} from "../public-types.js";
import { LocalProviderError } from "../errors/local-provider-error.js";

const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_AUDIT_TIMEOUT_MS = 1_000;
const DEFAULT_AUDIT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface AuditPolicy {
  readonly failurePolicy: AuditFailurePolicy;
  readonly writeMode: AuditWriteMode;
  readonly timeoutMs: number | undefined;
  readonly shutdownTimeoutMs: number;
}

export function resolveAuditPolicy(options: LocalProviderOptions): AuditPolicy {
  const failurePolicy = options.auditFailurePolicy ?? "bestEffort";
  if (failurePolicy !== "bestEffort" && failurePolicy !== "returnDefault") {
    throw new RangeError("auditFailurePolicy must be bestEffort or returnDefault.");
  }
  const requiresConfirmation = failurePolicy === "returnDefault";
  const writeMode = options.auditWriteMode ?? (requiresConfirmation ? "blocking" : "nonBlocking");
  if (writeMode !== "blocking" && writeMode !== "nonBlocking") {
    throw new RangeError("auditWriteMode must be blocking or nonBlocking.");
  }
  if (
    requiresConfirmation &&
    (writeMode !== "blocking" || typeof options.auditSink?.writeConfirmed !== "function")
  ) {
    throw new TypeError(
      "returnDefault requires blocking mode and an audit sink with writeConfirmed."
    );
  }
  const timeoutMs =
    options.auditTimeoutMs ??
    (writeMode === "blocking" && options.auditSink !== undefined
      ? DEFAULT_AUDIT_TIMEOUT_MS
      : undefined);
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_MS)
  ) {
    throw new RangeError("auditTimeoutMs must be an integer between 1 and 2147483647.");
  }
  if (timeoutMs !== undefined && (writeMode !== "blocking" || options.auditSink === undefined)) {
    throw new TypeError("auditTimeoutMs requires blocking mode and an audit sink.");
  }
  const shutdownTimeoutMs = options.auditShutdownTimeoutMs ?? DEFAULT_AUDIT_SHUTDOWN_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs <= 0 ||
    shutdownTimeoutMs > MAX_TIMER_MS
  )
    throw new RangeError("auditShutdownTimeoutMs must be an integer between 1 and 2147483647.");
  if (options.auditShutdownTimeoutMs !== undefined && options.auditSink === undefined)
    throw new TypeError("auditShutdownTimeoutMs requires an audit sink.");
  return { failurePolicy, writeMode, timeoutMs, shutdownTimeoutMs };
}

export async function flushAuditSink(
  sink: AuditSink | undefined,
  timeoutMs: number
): Promise<void> {
  const flush = sink?.flush;
  if (flush === undefined) return;
  try {
    await withinAuditDeadline(() => flush.call(sink), timeoutMs);
  } catch (error) {
    if (!(error instanceof AuditDeadlineError)) throw error;
    throw new LocalProviderError(
      "AUDIT_SINK_ERROR",
      "Audit shutdown flush timed out; pending writes may still complete."
    );
  }
}

export async function waitForAudit(
  write: () => Promise<boolean>,
  timeoutMs: number | undefined,
  onTimeout: () => void
): Promise<boolean> {
  if (timeoutMs === undefined) return write();
  try {
    return await withinAuditDeadline(write, timeoutMs);
  } catch (error) {
    if (!(error instanceof AuditDeadlineError)) throw error;
    onTimeout();
    return false;
  }
}

class AuditDeadlineError extends Error {}

async function withinAuditDeadline<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  // Start before invoking the sink; timer callbacks can run after promise continuations.
  const deadline = performance.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuditDeadlineError()), timeoutMs);
  });
  try {
    const result = await Promise.race([operation(), timeout]);
    if (performance.now() >= deadline) throw new AuditDeadlineError();
    return result;
  } finally {
    clearTimeout(timer);
  }
}
