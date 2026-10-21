import { LocalProviderError } from "../errors/local-provider-error.js";
import type { SignedSnapshotMetadata } from "../public-types.js";

const captured = new WeakSet<object>();
const HASH = /^[a-f0-9]{64}$/;

// Metadata is asserted by the caller; only a verifier authenticates its source.
export function captureSnapshotProvenance(
  input: SignedSnapshotMetadata | undefined,
  expectedHash: string
): SignedSnapshotMetadata | undefined {
  if (input === undefined) return undefined;
  try {
    if (captured.has(input)) {
      if (input.snapshotHash !== expectedHash) throw new Error();
      return input;
    }
    const own = (key: keyof SignedSnapshotMetadata): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor)) throw new Error();
      return descriptor.value;
    };
    const keyId = own("keyId");
    const audience = own("audience");
    const sequence = own("sequence");
    const issuedAt = own("issuedAt");
    const expiresAt = own("expiresAt");
    const snapshotHash = own("snapshotHash");
    const artifactHash = own("artifactHash");
    if (
      typeof keyId !== "string" ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(keyId) ||
      typeof audience !== "string" ||
      !/^[A-Za-z0-9._:/-]{1,128}$/.test(audience) ||
      typeof sequence !== "number" ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      typeof issuedAt !== "number" ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0 ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= issuedAt ||
      typeof snapshotHash !== "string" ||
      !HASH.test(snapshotHash) ||
      snapshotHash !== expectedHash ||
      typeof artifactHash !== "string" ||
      !HASH.test(artifactHash)
    )
      throw new Error();
    const result = Object.freeze({
      keyId,
      audience,
      sequence,
      issuedAt,
      expiresAt,
      snapshotHash,
      artifactHash
    });
    captured.add(result);
    return result;
  } catch {
    throw new LocalProviderError("SCHEMA_ERROR", "Snapshot provenance is invalid.");
  }
}
