import type { AuditFailurePolicy, AuditWriteMode, LocalProviderOptions } from "../public-types.js";

export interface AuditPolicy {
  readonly failurePolicy: AuditFailurePolicy;
  readonly writeMode: AuditWriteMode;
  readonly timeoutMs: number | undefined;
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
    (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
  ) {
    throw new RangeError("auditTimeoutMs must be an integer between 1 and 2147483647.");
  }
  if (timeoutMs !== undefined && (writeMode !== "blocking" || options.auditSink === undefined)) {
    throw new TypeError("auditTimeoutMs requires blocking mode and an audit sink.");
  }
  return { failurePolicy, writeMode, timeoutMs };
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
