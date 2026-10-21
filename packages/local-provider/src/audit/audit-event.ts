import { captureSnapshotProvenance } from "../flags/snapshot-provenance.js";
import { captureAuditPseudonym } from "./pseudonym.js";
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
  const snapshotHash = options.snapshotHash ?? createSnapshotHash(options.snapshot);
  const provenance = captureSnapshotProvenance(options.provenance, snapshotHash);
  const subject = options.request.targetingKey;
  const pseudonym =
    subject === undefined || subject === ""
      ? undefined
      : options.pseudonymizer?.pseudonymize(subject);
  return {
    ...(pseudonym !== undefined ? { pseudonym: captureAuditPseudonym(pseudonym) } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
    schemaVersion: 1,
    eventId: options.eventId ?? randomUUID(),
    timestamp: options.timestamp ?? new Date().toISOString(),
    providerName: options.providerName,
    flagKey: options.request.flagKey,
    requestedType: options.request.expectedType,
    reason: options.result.reason,
    source: options.result.source,
    ...(options.result.variant !== undefined ? { variant: options.result.variant } : {}),
    ...(options.result.ruleId !== undefined ? { ruleId: options.result.ruleId } : {}),
    ...(options.result.errorCode !== undefined ? { errorCode: options.result.errorCode } : {}),
    snapshotHash,
    ...resolveOverrideHash(options),
    context: redactRequestContext(options)
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
    targetingKeyPresent: targetingKeyPresent(context),
    keyMode,
    keys: keyMode === "names" ? contextKeys : [],
    ...(keyMode === "count" ? { keyCount: contextKeys.length } : {}),
    redacted: true
  };
}

function targetingKeyPresent(context: EvaluationContext): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(context, "targetingKey");
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    descriptor.value.length > 0
  );
}

function redactRequestContext(options: CreateAuditEventOptions): RedactedAuditContext {
  const context = options.request.context ?? {};
  const redacted = redactContext(context, options.redaction);
  const explicitKey = options.request.targetingKey;
  if (explicitKey === undefined) return redacted;
  const extraKey = Object.hasOwn(context, "targetingKey") ? 0 : 1;
  return {
    ...redacted,
    targetingKeyPresent: explicitKey.length > 0,
    ...(redacted.keyMode === "count" ? { keyCount: (redacted.keyCount ?? 0) + extraKey } : {}),
    ...(redacted.keyMode === "names" && extraKey
      ? { keys: [...redacted.keys, "targetingKey"].sort(compareCodeUnits) }
      : {})
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

export function stableStringify(value: JsonValue | object | undefined): string {
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
