import { createHash, randomUUID } from "node:crypto";
import type {
  AuditContextKeyMode,
  AuditEvent,
  AuditRedactionOptions,
  CreateAuditEventOptions,
  EnvOverrideState,
  EvaluationContext,
  FlagSnapshot,
  JsonValue,
  ReplayOverrideInput,
  RedactedAuditContext
} from "../public-types.js";

export function createAuditEvent(options: CreateAuditEventOptions): AuditEvent {
  return {
    schemaVersion: 1,
    eventId: options.eventId ?? randomUUID(),
    timestamp: options.timestamp ?? new Date().toISOString(),
    providerName: options.providerName,
    flagKey: options.request.flagKey,
    requestedType: options.request.expectedType,
    reason: options.result.reason,
    source: options.result.source,
    ...(options.result.variant !== undefined ? { variant: options.result.variant } : {}),
    ...(options.result.errorCode !== undefined ? { errorCode: options.result.errorCode } : {}),
    snapshotHash: options.snapshotHash ?? createSnapshotHash(options.snapshot),
    ...resolveOverrideHash(options),
    context: redactContext(
      {
        ...options.request.context,
        ...(options.request.targetingKey !== undefined
          ? { targetingKey: options.request.targetingKey }
          : {})
      },
      options.redaction
    )
  };
}

function resolveOverrideHash(
  options: CreateAuditEventOptions
): { readonly overrideHash: string } | Record<string, never> {
  if (options.overrideHash !== undefined) {
    return { overrideHash: options.overrideHash };
  }

  if (options.overrides !== undefined) {
    return { overrideHash: createOverrideHash(options.overrides) };
  }

  return {};
}

export function createSnapshotHash(snapshot: FlagSnapshot): string {
  return sha256Hex(stableStringify(snapshot));
}

export function createOverrideHash(overrides: EnvOverrideState | ReplayOverrideInput): string {
  return sha256Hex(stableStringify(overrides));
}

export function serializeAuditEvent(event: AuditEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function redactContext(
  context: EvaluationContext = {},
  options: AuditRedactionOptions = {}
): RedactedAuditContext {
  const keyMode = resolveAuditContextKeyMode(options);
  const contextKeys = Object.keys(context).sort(compareCodeUnits);

  return {
    targetingKeyPresent:
      typeof context.targetingKey === "string" && context.targetingKey.length > 0,
    keyMode,
    keys: keyMode === "names" ? contextKeys : [],
    ...(keyMode === "count" ? { keyCount: contextKeys.length } : {}),
    redacted: true
  };
}

export function resolveAuditContextKeyMode(
  options: AuditRedactionOptions = {}
): AuditContextKeyMode {
  const keyMode = options.contextKeys ?? "count";

  if (keyMode !== "names" && keyMode !== "count" && keyMode !== "none") {
    throw new TypeError("auditRedaction.contextKeys must be names, count, or none");
  }

  return keyMode;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: JsonValue | object | undefined): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => compareCodeUnits(leftKey, rightKey))
        .map(([entryKey, entryValue]) => [entryKey, sortForStableStringify(entryValue)])
    );
  }

  return value;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
