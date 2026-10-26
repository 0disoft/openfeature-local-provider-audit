import { beforeEach, expect, it, vi } from "vitest";
const hashes = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return {
    ...original,
    createHash(...args: Parameters<typeof original.createHash>) {
      hashes.calls++;
      return original.createHash(...args);
    }
  };
});
import {
  createAuditChainCheckpoint,
  createChainedAuditEvent,
  verifyAuditChainRecord,
  type AuditEvent
} from "../../src/index.js";

const event: AuditEvent = {
  schemaVersion: 1,
  eventId: "event",
  timestamp: "2026-10-26T00:00:00.000Z",
  providerName: "provider",
  flagKey: "feature",
  requestedType: "boolean",
  reason: "STATIC",
  source: "file",
  snapshotHash: "0".repeat(64),
  context: { targetingKeyPresent: false, keyMode: "none", keys: [], redacted: true }
};
const start = createAuditChainCheckpoint("service/production");
const first = createChainedAuditEvent(event, start);
const previous = {
  schemaVersion: 1 as const,
  chainId: first.chainId,
  sequence: first.sequence,
  hash: first.hash
};
const second = createChainedAuditEvent(event, previous);
beforeEach(() => {
  hashes.calls = 0;
});

it.each(["create", "verify"])(
  "hashes only the record when %s receives a positive checkpoint",
  (operation) => {
    const result =
      operation === "create"
        ? createChainedAuditEvent(event, previous)
        : verifyAuditChainRecord(second, previous);
    expect(result.hash).toBe(second.hash);
    expect(hashes.calls).toBe(1);
  }
);

it("still authenticates the zero checkpoint before hashing its first record", () => {
  expect(createChainedAuditEvent(event, start).hash).toBe(first.hash);
  expect(hashes.calls).toBe(2);
  const forged = { ...start, hash: "0".repeat(64) };
  expect(() => createChainedAuditEvent(event, forged)).toThrow();
  expect(() => verifyAuditChainRecord(first, forged)).toThrow();
});

it("rejects invalid chain IDs even at positive checkpoints", () => {
  for (const chainId of ["", "bad space", "x".repeat(129)]) {
    expect(() => createChainedAuditEvent(event, { ...previous, chainId })).toThrow();
    expect(() => verifyAuditChainRecord(second, { ...previous, chainId })).toThrow();
  }
  expect(hashes.calls).toBe(0);
});
