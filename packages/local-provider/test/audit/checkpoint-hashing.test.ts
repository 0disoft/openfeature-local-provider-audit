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

it.each([
  ["JSON escapes", "\0".repeat(1024)],
  ["UTF-8 expansion", "가".repeat(1024)]
])("rejects oversized %s before record hashing", (_name, key) => {
  const input: AuditEvent = {
    ...event,
    context: { ...event.context, keyMode: "names", keys: [key] }
  };
  for (const [checkpoint, expectedHashes] of [
    [previous, 0],
    [start, 1]
  ] as const) {
    hashes.calls = 0;
    expect(() => createChainedAuditEvent(input, checkpoint, { maxRecordBytes: 2048 })).toThrow(
      expect.objectContaining({ code: "SCHEMA_ERROR", message: "Audit chain verification failed." })
    );
    // Genesis authentication remains mandatory; only the record digest is skipped.
    expect(hashes.calls).toBe(expectedHashes);
  }
});

it("hashes exact-cap records and skips hashing one byte over the cap", () => {
  const maxRecordBytes = Buffer.byteLength(JSON.stringify(second));
  expect(createChainedAuditEvent(event, previous, { maxRecordBytes }).hash).toBe(second.hash);
  expect(hashes.calls).toBe(1);
  hashes.calls = 0;
  expect(() =>
    createChainedAuditEvent(event, previous, { maxRecordBytes: maxRecordBytes - 1 })
  ).toThrow(expect.objectContaining({ code: "SCHEMA_ERROR" }));
  expect(hashes.calls).toBe(0);
});
