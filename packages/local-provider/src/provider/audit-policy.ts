import type {
  AuditFailurePolicy,
  AuditSink,
  AuditWriteMode,
  LocalProviderOptions
} from "../public-types.js";
import { LocalProviderError } from "../errors/local-provider-error.js";

const MAX_TIMER_MS = 2_147_483_647;
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
  const timeoutMs = options.auditTimeoutMs ?? (requiresConfirmation ? 1_000 : undefined);
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new LocalProviderError(
            "AUDIT_SINK_ERROR",
            "Audit shutdown flush timed out; pending writes may still complete."
          )
        ),
      timeoutMs
    );
  });
  try {
    await Promise.race([Promise.resolve().then(() => flush.call(sink)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForAudit(
  write: Promise<boolean>,
  timeoutMs: number | undefined,
  onTimeout: () => void
): Promise<boolean> {
  if (timeoutMs === undefined) return write;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([write, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
