import { createHmac, createSecretKey } from "node:crypto";
import type {
  AuditPseudonym,
  AuditPseudonymizer,
  HmacAuditPseudonymizerOptions
} from "../public-types.js";

const DOMAIN = "openfeature-local-audit-subject/v1\0";
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);

export function createHmacAuditPseudonymizer(
  options: HmacAuditPseudonymizerOptions
): AuditPseudonymizer {
  const { keyId, scope, key } = options;
  if (
    !id(keyId) ||
    !id(scope) ||
    !(key instanceof Uint8Array) ||
    key.byteLength < 32 ||
    key.byteLength > 128
  )
    throw new TypeError("Audit pseudonyms require a 32..128 byte key and valid key ID/scope.");
  const secret = createSecretKey(Buffer.from(key));
  return Object.freeze({
    pseudonymize(subject: string): AuditPseudonym | undefined {
      if (typeof subject !== "string" || subject.length > 8192)
        throw new TypeError("Audit subject is invalid.");
      if (subject === "") return undefined;
      const bytes = Buffer.from(subject, "utf8");
      if (bytes.length > 8192 || bytes.toString("utf8") !== subject)
        throw new TypeError("Audit subject is invalid.");
      return Object.freeze({
        schemaVersion: 1,
        keyId,
        scope,
        hash: createHmac("sha256", secret)
          .update(DOMAIN)
          .update(JSON.stringify([keyId, scope, subject]), "utf8")
          .digest("hex")
      });
    }
  });
}

// Validate copies from custom pseudonymizers and serialized chain records alike.
export function captureAuditPseudonym(value: unknown): AuditPseudonym {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const allowed = ["schemaVersion", "keyId", "scope", "hash"];
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw invalid();
    result[key] = descriptor.value;
  }
  if (
    result.schemaVersion !== 1 ||
    !id(result.keyId) ||
    !id(result.scope) ||
    typeof result.hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(result.hash)
  )
    throw invalid();
  return Object.freeze(result) as unknown as AuditPseudonym;
}
function invalid(): TypeError {
  return new TypeError("Audit pseudonym metadata is invalid.");
}
