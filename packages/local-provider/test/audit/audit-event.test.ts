import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileAuditSink } from "../../src/audit/audit-sink.js";
import {
  createAuditEvent,
  redactContext,
  serializeAuditEvent
} from "../../src/audit/audit-event.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { EVALUATION_REASONS, EVALUATION_SOURCES } from "../../src/reasons.js";
import { staticSnapshot } from "../fixtures.js";

describe("audit events", () => {
  it("creates redacted JSON Lines audit events without raw context or values", () => {
    const request = {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean" as const,
      targetingKey: "user-alpha",
      context: {
        targetingKey: "user-alpha",
        email: "synthetic@example.test",
        tenantId: "tenant-test-1",
        token: "not-a-real-token"
      }
    };
    const result = evaluateFlag(staticSnapshot, request);
    const event = createAuditEvent({
      providerName: "openfeature-local-provider",
      snapshot: staticSnapshot,
      request,
      result,
      eventId: "evt_test_1",
      timestamp: "2026-07-06T00:00:00.000Z"
    });
    const jsonLine = serializeAuditEvent(event);

    expect(event).toMatchObject({
      schemaVersion: 1,
      eventId: "evt_test_1",
      timestamp: "2026-07-06T00:00:00.000Z",
      providerName: "openfeature-local-provider",
      flagKey: "checkout.rollout",
      requestedType: "boolean",
      reason: EVALUATION_REASONS.SPLIT,
      source: EVALUATION_SOURCES.FILE,
      variant: "on",
      context: {
        targetingKeyPresent: true,
        keys: ["email", "targetingKey", "tenantId", "token"],
        redacted: true
      }
    });
    expect(event.snapshotHash).toHaveLength(64);
    expect(jsonLine.endsWith("\n")).toBe(true);
    expect(jsonLine).not.toContain("user-alpha");
    expect(jsonLine).not.toContain("synthetic@example.test");
    expect(jsonLine).not.toContain("tenant-test-1");
    expect(jsonLine).not.toContain("not-a-real-token");
    expect(jsonLine).not.toContain('"value"');
  });

  it("hashes override input without writing raw override values", () => {
    const request = {
      flagKey: "checkout.enabled",
      defaultValue: false,
      expectedType: "boolean" as const
    };
    const result = evaluateFlag(staticSnapshot, request);
    const event = createAuditEvent({
      providerName: "openfeature-local-provider",
      snapshot: staticSnapshot,
      request,
      result,
      overrides: {
        env: {
          OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
        }
      },
      eventId: "evt_test_2",
      timestamp: "2026-07-06T00:00:00.000Z"
    });
    const jsonLine = serializeAuditEvent(event);

    expect(event.overrideHash).toHaveLength(64);
    expect(jsonLine).not.toContain("OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED");
  });

  it("redacts empty or missing context", () => {
    expect(redactContext()).toEqual({
      targetingKeyPresent: false,
      keys: [],
      redacted: true
    });
  });

  it("appends redacted audit events to a JSON Lines file", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "nested", "audit.jsonl");

    try {
      const request = {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean" as const,
        context: {
          email: "synthetic@example.test"
        }
      };
      const result = evaluateFlag(staticSnapshot, request);
      const event = createAuditEvent({
        providerName: "openfeature-local-provider",
        snapshot: staticSnapshot,
        request,
        result,
        eventId: "evt_file_sink_1",
        timestamp: "2026-07-06T00:00:00.000Z"
      });

      const auditSink = createFileAuditSink({ path: auditPath });

      await auditSink.write(event);
      await auditSink.flush?.();

      const content = await readFile(auditPath, "utf8");
      expect(content.split("\n")).toHaveLength(2);
      expect(JSON.parse(content.trim())).toMatchObject({
        eventId: "evt_file_sink_1",
        flagKey: "checkout.enabled",
        context: {
          keys: ["email"],
          redacted: true
        }
      });
      expect(content).not.toContain("synthetic@example.test");
      expect(content).not.toContain('"value"');
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("flushes pending file audit writes", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "flush", "audit.jsonl");

    try {
      const auditSink = createFileAuditSink({ path: auditPath });
      const request = {
        flagKey: "checkout.enabled",
        defaultValue: false,
        expectedType: "boolean" as const
      };
      const result = evaluateFlag(staticSnapshot, request);
      const event = createAuditEvent({
        providerName: "openfeature-local-provider",
        snapshot: staticSnapshot,
        request,
        result,
        eventId: "evt_flush_sink_1",
        timestamp: "2026-07-06T00:00:00.000Z"
      });

      const pendingWrite = auditSink.write(event);
      await auditSink.flush?.();
      await pendingWrite;

      const content = await readFile(auditPath, "utf8");
      expect(JSON.parse(content.trim())).toMatchObject({
        eventId: "evt_flush_sink_1",
        flagKey: "checkout.enabled"
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rotates file audit logs by size and retained file count", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "rotate", "audit.jsonl");
    const firstEvent = createTestAuditEvent("evt_rotate_1");
    const maxBytes = Buffer.byteLength(serializeAuditEvent(firstEvent), "utf8") + 1;

    try {
      const auditSink = createFileAuditSink({
        path: auditPath,
        maxBytes,
        maxFiles: 2
      });

      await auditSink.write(firstEvent);
      await auditSink.write(createTestAuditEvent("evt_rotate_2"));
      await auditSink.write(createTestAuditEvent("evt_rotate_3"));
      await auditSink.flush?.();

      expect(await readFile(auditPath, "utf8")).toContain("evt_rotate_3");
      expect(await readFile(`${auditPath}.1`, "utf8")).toContain("evt_rotate_2");
      expect(await readFile(`${auditPath}.2`, "utf8")).toContain("evt_rotate_1");
      await expect(readFile(`${auditPath}.3`, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rejects invalid file audit rotation options", () => {
    expect(() => createFileAuditSink({ path: "audit.jsonl", maxBytes: 0 })).toThrow(
      "maxBytes must be greater than 0"
    );
    expect(() => createFileAuditSink({ path: "audit.jsonl", maxBytes: 1, maxFiles: -1 })).toThrow(
      "maxFiles must be a non-negative integer"
    );
  });
});

function createTestAuditEvent(eventId: string) {
  const request = {
    flagKey: "checkout.enabled",
    defaultValue: false,
    expectedType: "boolean" as const
  };
  const result = evaluateFlag(staticSnapshot, request);

  return createAuditEvent({
    providerName: "openfeature-local-provider",
    snapshot: staticSnapshot,
    request,
    result,
    eventId,
    timestamp: "2026-07-06T00:00:00.000Z"
  });
}
