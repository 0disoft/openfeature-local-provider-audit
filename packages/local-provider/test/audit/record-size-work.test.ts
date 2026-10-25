import { expect, it, vi } from "vitest";
import {
  createChainedAuditEvent,
  createAuditChainCheckpoint,
  verifyAuditChainRecord
} from "../../src/audit/audit-chain.js";
import { stableStringify } from "../../src/audit/audit-event.js";
import type { AuditEvent } from "../../src/public-types.js";

const start = createAuditChainCheckpoint("record-size");
function event(extra: Partial<AuditEvent> = {}): AuditEvent {
  return {
    schemaVersion: 1,
    eventId: "event",
    timestamp: "2026-10-21T00:00:00.000Z",
    providerName: "provider",
    flagKey: "flag",
    requestedType: "boolean",
    reason: "STATIC",
    source: "file",
    snapshotHash: "a".repeat(64),
    context: { targetingKeyPresent: false, keyMode: "names", keys: ["z", "a"], redacted: true },
    ...extra
  };
}

it.each(["create", "verify"] as const)(
  "%s canonicalizes and serializes the captured graph only once",
  (operation) => {
    const input = event();
    const record = createChainedAuditEvent(input, start);
    const copy = vi.spyOn(Object, "fromEntries");
    const serialize = vi.spyOn(JSON, "stringify");
    let calls = 0;
    let serializations = 0;
    try {
      if (operation === "create") createChainedAuditEvent(input, start);
      else verifyAuditChainRecord(record, start);
      calls = copy.mock.calls.length;
      serializations = serialize.mock.calls.length;
    } finally {
      copy.mockRestore();
      serialize.mockRestore();
    }
    // One canonical body, event and context; no second copy merely to count bytes.
    expect(calls).toBe(3);
    expect(serializations).toBe(1);
  }
);

it.each([
  ["ASCII", {}],
  ["Unicode and JSON escapes", { providerName: '가😀\u0000"\\\ud800' }],
  [
    "optional metadata",
    {
      schedule: { evaluatedAt: 123, stage: null, percentage: 0 },
      pseudonym: { schemaVersion: 1, scope: "scope", keyId: "key", hash: "c".repeat(64) },
      provenance: {
        audience: "audience",
        keyId: "key",
        sequence: 1,
        issuedAt: 1,
        expiresAt: 2,
        snapshotHash: "a".repeat(64),
        artifactHash: "b".repeat(64)
      }
    }
  ]
] satisfies [string, Partial<AuditEvent>][])(
  "preserves exact byte boundaries with %s",
  (_name, extra) => {
    const input = event(extra);
    const record = createChainedAuditEvent(input, start);
    // Reorder object members without changing the authenticated semantic record.
    const reordered = Object.fromEntries(Object.entries(record).reverse());
    const bytes = Buffer.byteLength(JSON.stringify(record));
    expect(Buffer.byteLength(stableStringify(record))).toBe(bytes);
    for (const maxRecordBytes of [bytes, bytes + 1]) {
      expect(createChainedAuditEvent(input, start, { maxRecordBytes }).hash).toBe(record.hash);
      expect(verifyAuditChainRecord(reordered, start, { maxRecordBytes }).hash).toBe(record.hash);
    }
    const maxRecordBytes = bytes - 1;
    expect(() => createChainedAuditEvent(input, start, { maxRecordBytes })).toThrow(
      expect.objectContaining({ code: "SCHEMA_ERROR" })
    );
    expect(() => verifyAuditChainRecord(reordered, start, { maxRecordBytes })).toThrow(
      expect.objectContaining({ code: "SCHEMA_ERROR" })
    );
  }
);
