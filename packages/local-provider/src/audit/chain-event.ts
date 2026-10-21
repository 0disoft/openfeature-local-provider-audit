import { LocalProviderError } from "../errors/local-provider-error.js";
import { LOCAL_PROVIDER_ERROR_CODES } from "../errors/error-codes.js";
import { captureSnapshotProvenance } from "../flags/snapshot-provenance.js";
import { captureAuditPseudonym } from "./pseudonym.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../reasons.js";
import type { AuditEvent, SignedSnapshotMetadata } from "../public-types.js";

const REQUIRED = [
  "schemaVersion",
  "eventId",
  "timestamp",
  "providerName",
  "flagKey",
  "requestedType",
  "reason",
  "source",
  "snapshotHash",
  "context"
];
const OPTIONAL = ["variant", "ruleId", "errorCode", "overrideHash", "provenance", "pseudonym"];

export function captureChainEvent(input: unknown, maxBytes: number): AuditEvent {
  const event = dataRecord(input, [...REQUIRED, ...OPTIONAL], REQUIRED);
  let remaining = maxBytes;
  const string = (value: unknown): void => {
    if (typeof value !== "string" || value.length > remaining) throw invalidChain();
    remaining -= value.length;
  };
  if (event.schemaVersion !== 1) throw invalidChain();
  for (const key of ["eventId", "timestamp", "providerName", "flagKey"]) string(event[key]);
  if (
    !["boolean", "string", "number", "object"].includes(event.requestedType as string) ||
    !Object.values(EVALUATION_REASONS).includes(event.reason as never) ||
    !Object.values(EVALUATION_SOURCES).includes(event.source as never) ||
    !isHash(event.snapshotHash)
  )
    throw invalidChain();
  for (const key of ["variant", "ruleId"]) if (event[key] !== undefined) string(event[key]);
  if (
    event.errorCode !== undefined &&
    !Object.values(LOCAL_PROVIDER_ERROR_CODES).includes(event.errorCode as never)
  )
    throw invalidChain();
  if (event.overrideHash !== undefined && !isHash(event.overrideHash)) throw invalidChain();
  if (event.pseudonym !== undefined) event.pseudonym = captureAuditPseudonym(event.pseudonym);
  if (event.provenance !== undefined)
    event.provenance = captureSnapshotProvenance(
      dataRecord(event.provenance, [
        "keyId",
        "audience",
        "sequence",
        "issuedAt",
        "expiresAt",
        "snapshotHash",
        "artifactHash"
      ]) as unknown as SignedSnapshotMetadata,
      event.snapshotHash as string
    );
  const context = dataRecord(
    event.context,
    ["targetingKeyPresent", "keyMode", "keys", "keyCount", "redacted"],
    ["targetingKeyPresent", "keys", "redacted"]
  );
  if (
    context.redacted !== true ||
    typeof context.targetingKeyPresent !== "boolean" ||
    (context.keyMode !== undefined &&
      !["names", "count", "none"].includes(context.keyMode as string)) ||
    !Array.isArray(context.keys) ||
    context.keys.length > 10_000 ||
    (context.keyMode !== "names" && context.keys.length !== 0) ||
    (context.keyMode === "count" && !isSequence(context.keyCount)) ||
    (context.keyCount !== undefined &&
      (context.keyMode !== "count" || !isSequence(context.keyCount)))
  )
    throw invalidChain();
  const keys: string[] = [];
  for (let index = 0; index < context.keys.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(context.keys, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw invalidChain();
    string(descriptor.value);
    keys.push(descriptor.value as string);
  }
  context.keys = Object.freeze(keys);
  event.context = Object.freeze(context);
  return Object.freeze(event) as unknown as AuditEvent;
}

export function dataRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidChain();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw invalidChain();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw invalidChain();
    if (descriptor.value !== undefined) result[key] = descriptor.value;
  }
  if (!required.every((key) => Object.hasOwn(result, key))) throw invalidChain();
  return result;
}

export function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function invalidChain(): LocalProviderError {
  return new LocalProviderError("SCHEMA_ERROR", "Audit chain verification failed.");
}
