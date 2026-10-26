import { createHash, createPublicKey, KeyObject, sign, verify } from "node:crypto";
import { createSnapshotHash } from "../audit/audit-event.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { validateFlagSnapshot } from "../flags/validate-snapshot.js";
import type {
  SignedSnapshotMetadata,
  SignFlagSnapshotOptions,
  SnapshotVerificationOptions,
  SnapshotVerifier
} from "../public-types.js";
import { DEFAULT_SOURCE_BYTES, sourceInteger } from "./source-policy.js";

const TYPE = "openfeature-local-snapshot+jws";
// Separator plus the 86 unpadded base64url characters of an Ed25519 signature.
const SIGNATURE_SUFFIX_BYTES = 87;
const DAY = 86_400_000;
const HEADER_KEYS = ["alg", "kid", "typ"];
const CLAIM_KEYS = ["schemaVersion", "audience", "sequence", "issuedAt", "expiresAt", "snapshot"];

export function signFlagSnapshot(options: SignFlagSnapshotOptions): string {
  const { privateKey, keyId, audience, sequence, issuedAt, expiresAt } = options;
  if (
    !(privateKey instanceof KeyObject) ||
    privateKey.type !== "private" ||
    privateKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new TypeError("Signing requires an Ed25519 private KeyObject.");
  }
  const maxBytes = byteLimit(options.maxBytes);
  if (
    !validId(keyId) ||
    !validAudience(audience) ||
    !validSequence(sequence) ||
    !validTimes(issuedAt, expiresAt)
  ) {
    throw new TypeError("Signed snapshot identity, sequence or times are invalid.");
  }
  const snapshot = validateFlagSnapshot(options.snapshot);
  const header = encode({ alg: "Ed25519", kid: keyId, typ: TYPE });
  const payload = encode(
    { schemaVersion: 1, audience, sequence, issuedAt, expiresAt, snapshot },
    maxBytes - header.length - 1 - SIGNATURE_SUFFIX_BYTES
  );
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input, "ascii"), privateKey).toString("base64url")}`;
}

export function createSnapshotVerifier(options: SnapshotVerificationOptions): SnapshotVerifier {
  return createVerifier(options, false);
}

// Internal recovery-only verifier: never used to decide whether a snapshot is fresh.
export function createHistoricalSnapshotVerifier(
  options: SnapshotVerificationOptions
): SnapshotVerifier {
  return createVerifier(options, true);
}

function createVerifier(
  options: SnapshotVerificationOptions,
  historical: boolean
): SnapshotVerifier {
  const audience = options.audience;
  if (!validAudience(audience)) throw new TypeError("Snapshot audience is invalid.");
  const minSequence = sourceInteger(
    "minSequence",
    options.minSequence ?? 0,
    0,
    Number.MAX_SAFE_INTEGER
  );
  const maxAgeMs = sourceInteger("maxAgeMs", options.maxAgeMs ?? 7 * DAY, 1, 366 * DAY);
  const maxLifetimeMs = sourceInteger(
    "maxLifetimeMs",
    options.maxLifetimeMs ?? 7 * DAY,
    1,
    366 * DAY
  );
  const clockSkewMs = sourceInteger("clockSkewMs", options.clockSkewMs ?? 30_000, 0, 300_000);
  const maxBytes = byteLimit(options.maxBytes);
  const keys = captureKeys(options.trustedKeys);
  return {
    verify(content, previous) {
      try {
        if (content.byteLength > maxBytes) throw invalid();
        const token = new TextDecoder("utf-8", { fatal: true }).decode(content).trim();
        // Four parts suffice to reject extra separators without allocating one per dot.
        const parts = token.split(".", 4);
        if (parts.length !== 3) throw invalid();
        const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
        if (headerPart.length > 1_024 || signaturePart.length !== 86) throw invalid();
        const header = parseObject(decode(headerPart));
        if (
          !exactKeys(header, HEADER_KEYS) ||
          header.alg !== "Ed25519" ||
          header.typ !== TYPE ||
          !validId(header.kid)
        )
          throw invalid();
        const key = keys.get(header.kid);
        const signature = decode(signaturePart);
        if (
          key === undefined ||
          signature.byteLength !== 64 ||
          !verify(null, Buffer.from(`${headerPart}.${payloadPart}`, "ascii"), key, signature)
        )
          throw invalid();
        // No claims/snapshot parsing until the signature has authenticated the payload bytes.
        const claims = parseObject(decode(payloadPart));
        if (
          !exactKeys(claims, CLAIM_KEYS) ||
          claims.schemaVersion !== 1 ||
          claims.audience !== audience ||
          !validSequence(claims.sequence) ||
          !validTimes(claims.issuedAt, claims.expiresAt)
        )
          throw invalid();
        const sequence = claims.sequence;
        const issuedAt = claims.issuedAt as number;
        const expiresAt = claims.expiresAt as number;
        const now = Date.now();
        if (
          !Number.isSafeInteger(now) ||
          now < 0 ||
          (!historical && sequence < minSequence) ||
          issuedAt > now + clockSkewMs ||
          (!historical && now >= expiresAt) ||
          (!historical && now - issuedAt > maxAgeMs) ||
          expiresAt - issuedAt > maxLifetimeMs
        )
          throw invalid();
        const artifactHash = createHash("sha256").update(token, "ascii").digest("hex");
        if (previous !== undefined) {
          if (
            previous.audience !== audience ||
            !validId(previous.keyId) ||
            !validSequence(previous.sequence) ||
            !validTimes(previous.issuedAt, previous.expiresAt) ||
            !/^[a-f0-9]{64}$/.test(previous.artifactHash) ||
            !/^[a-f0-9]{64}$/.test(previous.snapshotHash) ||
            sequence < previous.sequence ||
            issuedAt < previous.issuedAt ||
            (sequence === previous.sequence && artifactHash !== previous.artifactHash)
          )
            throw invalid();
        }
        const snapshot = validateFlagSnapshot(claims.snapshot);
        const provenance: SignedSnapshotMetadata = Object.freeze({
          keyId: header.kid,
          audience,
          sequence,
          issuedAt,
          expiresAt,
          snapshotHash: createSnapshotHash(snapshot),
          artifactHash
        });
        return Object.freeze({ snapshot, provenance });
      } catch {
        throw invalid();
      }
    }
  };
}

function captureKeys(
  input: SnapshotVerificationOptions["trustedKeys"]
): ReadonlyMap<string, KeyObject> {
  try {
    const entries = Object.entries(input);
    if (entries.length < 1 || entries.length > 32) throw invalid();
    return new Map(
      entries.map(([id, value]) => {
        if (!validId(id)) throw invalid();
        let key: KeyObject;
        if (typeof value === "string") {
          if (
            value.length > 4_096 ||
            !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(value)
          )
            throw invalid();
          key = createPublicKey(value);
        } else {
          key = value;
        }
        if (
          !(key instanceof KeyObject) ||
          key.type !== "public" ||
          key.asymmetricKeyType !== "ed25519"
        )
          throw invalid();
        return [id, key] as const;
      })
    );
  } catch {
    throw new TypeError("trustedKeys requires 1 to 32 named Ed25519 public keys.");
  }
}

function encode(value: object, maxEncodedBytes?: number): string {
  const json = JSON.stringify(value);
  // Unpadded base64url uses ceil(4 * UTF-8 bytes / 3) ASCII bytes.
  if (
    maxEncodedBytes !== undefined &&
    Math.ceil((Buffer.byteLength(json, "utf8") * 4) / 3) > maxEncodedBytes
  )
    throw new RangeError("Signed snapshot exceeds maxBytes.");
  return Buffer.from(json, "utf8").toString("base64url");
}
function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw invalid();
  return bytes;
}
function parseObject(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function exactKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}
function validAudience(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
}
function validSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function validTimes(issuedAt: unknown, expiresAt: unknown): boolean {
  return (
    typeof issuedAt === "number" &&
    typeof expiresAt === "number" &&
    Number.isSafeInteger(issuedAt) &&
    issuedAt >= 0 &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > issuedAt
  );
}
function byteLimit(value: number | undefined): number {
  return sourceInteger("maxBytes", value ?? DEFAULT_SOURCE_BYTES, 1, 100 * 1024 * 1024);
}
function invalid(): LocalProviderError {
  return new LocalProviderError("SCHEMA_ERROR", "Signed snapshot verification failed.");
}
