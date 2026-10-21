import { createSnapshotHash } from "../../src/audit/audit-event.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAuditChainCheckpoint,
  createChainedAuditEvent,
  verifyAuditChain,
  verifyAuditChainRecord,
  type AuditEvent,
  type AuditChainCheckpoint
} from "../../src/index.js";

function event(): AuditEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    timestamp: "2026-10-21T00:00:00.000Z",
    providerName: "provider",
    flagKey: "feature",
    requestedType: "boolean",
    reason: "STATIC",
    source: "file",
    snapshotHash: createSnapshotHash({ schemaVersion: 1, flags: {} }),
    context: { targetingKeyPresent: false, keyMode: "none", keys: [], redacted: true }
  };
}
const start = createAuditChainCheckpoint("service/production");
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("audit chain", () => {
  it("matches independent domain-separated native SHA-256 and manually ordered canonical bytes", () => {
    expect(start.hash).toBe(digest("openfeature-local-audit-genesis/v1\0service/production"));
    const input = event(),
      record = createChainedAuditEvent(input, start);
    const body = JSON.stringify({
      chainId: start.chainId,
      event: {
        context: { keyMode: "none", keys: [], redacted: true, targetingKeyPresent: false },
        eventId: input.eventId,
        flagKey: input.flagKey,
        providerName: input.providerName,
        reason: "STATIC",
        requestedType: "boolean",
        schemaVersion: 1,
        snapshotHash: input.snapshotHash,
        source: "file",
        timestamp: input.timestamp
      },
      previousHash: start.hash,
      schemaVersion: 1,
      sequence: 1
    });
    expect(record.hash).toBe(digest(`openfeature-local-audit-record/v1\0${body}`));
    const head = verifyAuditChainRecord(JSON.parse(JSON.stringify(record)), start);
    expect(verifyAuditChain([record], { start, expectedHead: head })).toEqual({
      records: 1,
      head,
      checkpointMatched: true
    });
  });

  it("verifies retained suffixes and detects changes, gaps, duplication, reorder and wrong chains", () => {
    const first = createChainedAuditEvent(event(), start),
      one = verifyAuditChainRecord(first, start);
    const second = createChainedAuditEvent(event(), one),
      two = verifyAuditChainRecord(second, one);
    const third = createChainedAuditEvent(event(), two),
      head = verifyAuditChainRecord(third, two);
    expect(verifyAuditChain([second, third], { start: one, expectedHead: head }).records).toBe(2);
    for (const records of [
      [first, third],
      [second, first],
      [first, first],
      [first, { ...second, event: { ...second.event, flagKey: "changed" } }],
      [first, { ...second, chainId: "other" }],
      [first, { ...second, hash: first.hash }]
    ]) {
      expect(() => verifyAuditChain(records, { start })).toThrow(
        "Audit chain verification failed."
      );
    }
    // Unanchored truncation is valid; a trusted exact head detects that missing tail.
    expect(verifyAuditChain([first], { start }).checkpointMatched).toBe(false);
    expect(() => verifyAuditChain([first], { start, expectedHead: head })).toThrow();
    expect(() => verifyAuditChain([first, second, third], { start, expectedHead: one })).toThrow();
  });

  it("captures frozen event/context/provenance without getters, toJSON or unknown private fields", () => {
    const input = {
      ...event(),
      context: {
        targetingKeyPresent: true,
        keyMode: "names" as const,
        keys: ["region"],
        redacted: true as const
      }
    };
    const record = createChainedAuditEvent(input, start);
    input.context.keys.push("later");
    expect(record.event.context.keys).toEqual(["region"]);
    expect(Object.isFrozen(record.event.context.keys)).toBe(true);
    const getter = vi.fn(() => "private-value"),
      toJSON = vi.fn();
    const accessor = { ...event() };
    Object.defineProperty(accessor, "flagKey", { get: getter });
    for (const invalid of [
      accessor,
      { ...event(), toJSON },
      { ...event(), value: "private-value" },
      { ...event(), context: { ...event().context, email: "private-value" } },
      { ...event(), [Symbol("extra")]: true }
    ]) {
      expect(() => createChainedAuditEvent(invalid as AuditEvent, start)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    const provenance = {
      keyId: "release",
      audience: "service/production",
      sequence: 1,
      issuedAt: 1,
      expiresAt: 2,
      snapshotHash: event().snapshotHash,
      artifactHash: digest("signed artifact")
    };
    const signed = createChainedAuditEvent({ ...event(), provenance }, start);
    provenance.sequence = 2;
    expect(signed.event.provenance?.sequence).toBe(1);
    expect(() =>
      verifyAuditChainRecord(
        {
          ...signed,
          event: {
            ...signed.event,
            provenance: { ...signed.event.provenance, raw: "private-value" }
          }
        },
        start
      )
    ).toThrow();
  });

  it("rejects malformed redaction, event fields, checkpoints, size and sequence overflow", () => {
    for (const bad of [
      { ...event(), schemaVersion: 2 },
      { ...event(), requestedType: "invalid" },
      { ...event(), reason: "invalid" },
      { ...event(), source: "invalid" },
      { ...event(), snapshotHash: "bad" },
      { ...event(), errorCode: "invalid" },
      { ...event(), overrideHash: "bad" },
      { ...event(), context: { ...event().context, keys: ["hidden"] } },
      { ...event(), context: { ...event().context, keyCount: 3 } },
      { ...event(), context: { ...event().context, keyMode: "count" } },
      {
        ...event(),
        context: { ...event().context, keyMode: "names", keys: Array(10_001).fill("") }
      }
    ]) {
      expect(() => createChainedAuditEvent(bad as AuditEvent, start)).toThrow();
    }
    const count = createChainedAuditEvent(
      { ...event(), context: { ...event().context, keyMode: "count", keyCount: 3 } },
      start
    );
    expect(verifyAuditChain([count], { start }).records).toBe(1);
    for (const bad of [
      { ...start, hash: digest("wrong genesis") },
      { ...start, sequence: -1 },
      { ...start, extra: true },
      { ...start, sequence: Number.MAX_SAFE_INTEGER }
    ])
      expect(() => createChainedAuditEvent(event(), bad as AuditChainCheckpoint)).toThrow();
    expect(() => createAuditChainCheckpoint("personal identifier with spaces")).toThrow();
    expect(() => createChainedAuditEvent(event(), start, { maxRecordBytes: 1 })).toThrow();
    expect(() => verifyAuditChain([count], { start, maxRecords: 0 })).toThrow();
    expect(() => verifyAuditChain([], { start, maxRecordBytes: Number.NaN })).toThrow();
    expect(verifyAuditChain([], { start, expectedHead: start }).checkpointMatched).toBe(true);
  });
});
