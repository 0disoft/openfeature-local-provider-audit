import { createHash, randomUUID } from "node:crypto";
import type {
  AuditEvent,
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
    context: redactContext({
      ...options.request.context,
      ...(options.request.targetingKey !== undefined
        ? { targetingKey: options.request.targetingKey }
        : {})
    })
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

export function redactContext(context: EvaluationContext = {}): RedactedAuditContext {
  return {
    targetingKeyPresent:
      typeof context.targetingKey === "string" && context.targetingKey.length > 0,
    keys: Object.keys(context).sort(),
    redacted: true
  };
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
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([entryKey, entryValue]) => [entryKey, sortForStableStringify(entryValue)])
    );
  }

  return value;
}
