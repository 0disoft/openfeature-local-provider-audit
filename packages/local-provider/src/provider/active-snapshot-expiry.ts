import type { SignedSnapshotMetadata } from "../public-types.js";

export interface ActiveSnapshotExpiry {
  unavailable(now: number): boolean;
}

export function createActiveSnapshotExpiry(
  provenance: SignedSnapshotMetadata | undefined,
  previous?: {
    readonly provenance: SignedSnapshotMetadata | undefined;
    readonly expiry: ActiveSnapshotExpiry | undefined;
  }
): ActiveSnapshotExpiry | undefined {
  if (provenance === undefined) return undefined;
  const old = previous?.provenance;
  if (
    old !== undefined &&
    previous?.expiry !== undefined &&
    old.artifactHash === provenance.artifactHash &&
    old.snapshotHash === provenance.snapshotHash &&
    old.keyId === provenance.keyId &&
    old.audience === provenance.audience &&
    old.sequence === provenance.sequence &&
    old.issuedAt === provenance.issuedAt &&
    old.expiresAt === provenance.expiresAt
  )
    return previous.expiry;
  let expired = false;
  return Object.freeze({
    unavailable(now: number): boolean {
      if (expired) return true;
      if (!Number.isSafeInteger(now) || now < 0) return true;
      expired = now >= provenance.expiresAt;
      return expired;
    }
  });
}
