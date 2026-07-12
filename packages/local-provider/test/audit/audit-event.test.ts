import { createHash } from "node:crypto";
import {
  mkdir,
  link,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireFileLock, createFileAuditSink } from "../../src/audit/audit-sink.js";
import {
  createAuditEvent,
  createSnapshotHash,
  redactContext,
  serializeAuditEvent
} from "../../src/audit/audit-event.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import type { FlagSnapshot } from "../../src/public-types.js";
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
        keyMode: "names",
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
      keyMode: "names",
      keys: [],
      redacted: true
    });
  });

  it("can replace context key names with a count", () => {
    expect(
      redactContext(
        {
          targetingKey: "user-alpha",
          email: "synthetic@example.test",
          tenantId: "tenant-test-1"
        },
        { contextKeys: "count" }
      )
    ).toEqual({
      targetingKeyPresent: true,
      keyMode: "count",
      keys: [],
      keyCount: 3,
      redacted: true
    });
  });

  it("can omit context key names and counts", () => {
    const request = {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean" as const,
      targetingKey: "user-alpha",
      context: {
        email: "synthetic@example.test",
        tenantId: "tenant-test-1"
      }
    };
    const event = createAuditEvent({
      providerName: "openfeature-local-provider",
      snapshot: staticSnapshot,
      request,
      result: evaluateFlag(staticSnapshot, request),
      redaction: { contextKeys: "none" }
    });
    const jsonLine = serializeAuditEvent(event);

    expect(event.context).toEqual({
      targetingKeyPresent: true,
      keyMode: "none",
      keys: [],
      redacted: true
    });
    expect(jsonLine).not.toContain("email");
    expect(jsonLine).not.toContain("tenantId");
    expect(jsonLine).not.toContain("synthetic@example.test");
    expect(jsonLine).not.toContain("tenant-test-1");
    expect(jsonLine).not.toContain("user-alpha");
  });

  it("rejects unsupported context key redaction modes", () => {
    expect(() => redactContext({}, { contextKeys: "values" as never })).toThrow(
      "auditRedaction.contextKeys must be names, count, or none"
    );
  });

  it("hashes snapshots with locale-independent key ordering", () => {
    const snapshot = {
      schemaVersion: 1,
      flags: {
        "ä.flag": {
          type: "boolean",
          defaultVariant: "on",
          variants: {
            on: true,
            off: false
          }
        },
        "z.flag": {
          type: "boolean",
          defaultVariant: "off",
          variants: {
            on: true,
            off: false
          }
        }
      },
      metadata: {
        ä: 1,
        z: 2
      }
    } satisfies FlagSnapshot;
    const stableJson =
      '{"flags":{"z.flag":{"defaultVariant":"off","type":"boolean","variants":{"off":false,"on":true}},"ä.flag":{"defaultVariant":"on","type":"boolean","variants":{"off":false,"on":true}}},"metadata":{"z":2,"ä":1},"schemaVersion":1}';

    expect(redactContext({ ä: 1, z: 2 }).keys).toEqual(["z", "ä"]);
    expect(createSnapshotHash(snapshot)).toBe(sha256Hex(stableJson));
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
          keyMode: "names",
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

  it("flush waits for queued writes even when an earlier write fails", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "flush-failure", "audit.jsonl");
    const lockPath = `${auditPath}.lock`;

    try {
      await mkdir(join(tempDirectory, "flush-failure"), { recursive: true });
      await writeFile(lockPath, "locked", "utf8");
      const auditSink = createFileAuditSink({
        path: auditPath,
        lock: true,
        lockTimeoutMs: 50
      });
      const firstWrite = auditSink.write(createTestAuditEvent("evt_flush_failure_1"));
      const secondWrite = auditSink.write(createTestAuditEvent("evt_flush_failure_2"));
      const flush = auditSink.flush;
      if (flush === undefined) {
        throw new Error("Expected file audit sink to expose flush.");
      }
      const flushResult = flush().then(
        () => ({ status: "resolved" as const, content: "" }),
        async (error: unknown) => ({
          status: "rejected" as const,
          error,
          content: await readFile(auditPath, "utf8").catch(() => "")
        })
      );

      try {
        await expect(firstWrite).rejects.toThrow("Timed out acquiring audit file lock");
      } finally {
        await rm(lockPath, { force: true });
      }

      await secondWrite;

      const result = await flushResult;
      expect(result.status).toBe("rejected");
      expect(result.content).toContain("evt_flush_failure_2");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("reports a settled write failure once through a later flush", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));

    try {
      const auditSink = createFileAuditSink({
        path: tempDirectory,
        createDirectory: false
      });

      await expect(auditSink.write(createTestAuditEvent("evt_settled_failure"))).rejects.toThrow();
      await expect(auditSink.flush?.()).rejects.toThrow();
      await expect(auditSink.flush?.()).resolves.toBeUndefined();
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("bounds retained causes while preserving the settled failure count", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));

    try {
      const auditSink = createFileAuditSink({
        path: tempDirectory,
        createDirectory: false
      });
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, index) =>
          auditSink.write(createTestAuditEvent(`evt_bounded_failure_${index}`))
        )
      );

      expect(results.every((result) => result.status === "rejected")).toBe(true);
      let flushError: unknown;
      try {
        await auditSink.flush?.();
      } catch (error) {
        flushError = error;
      }
      expect(flushError).toBeInstanceOf(AggregateError);
      expect((flushError as AggregateError).errors).toHaveLength(16);
      expect((flushError as AggregateError).message).toContain("20 audit writes failed");
      await expect(auditSink.flush?.()).resolves.toBeUndefined();
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

  it("serializes rotation across file sinks in the same process", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "shared", "audit.jsonl");
    const eventIds = Array.from({ length: 32 }, (_, index) => `evt_shared_${index}`);
    const sampleBytes = Buffer.byteLength(
      serializeAuditEvent(createTestAuditEvent(eventIds[0] ?? "evt_shared_sample")),
      "utf8"
    );
    const sinks = Array.from({ length: 4 }, () =>
      createFileAuditSink({
        path: auditPath,
        maxBytes: sampleBytes + 1,
        maxFiles: eventIds.length + 2
      })
    );

    try {
      await Promise.all(
        eventIds.map((eventId, index) => {
          const sink = sinks[index % sinks.length];
          if (sink === undefined) {
            throw new Error("Expected a shared audit sink.");
          }
          return sink.write(createTestAuditEvent(eventId));
        })
      );
      await Promise.all(sinks.map((sink) => sink.flush?.()));

      const files = (await readdir(join(tempDirectory, "shared"))).filter((name) =>
        /^audit\.jsonl(?:\.\d+)?$/.test(name)
      );
      const recordedIds = new Set<string>();
      for (const file of files) {
        const contents = await readFile(join(tempDirectory, "shared", file), "utf8");
        for (const line of contents.trim().split("\n")) {
          if (line) {
            recordedIds.add((JSON.parse(line) as { eventId: string }).eventId);
          }
        }
      }

      expect(recordedIds).toEqual(new Set(eventIds));
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("rejects symbolic-link audit paths", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const targetPath = join(tempDirectory, "target.txt");
    const auditPath = join(tempDirectory, "audit.jsonl");

    try {
      await writeFile(targetPath, "unchanged\n", "utf8");
      await symlink(targetPath, auditPath);
      const auditSink = createFileAuditSink({ path: auditPath, createDirectory: false });

      await expect(auditSink.write(createTestAuditEvent("evt_symlink"))).rejects.toThrow(
        "must not be a symbolic link"
      );
      const rotatingSink = createFileAuditSink({
        path: auditPath,
        createDirectory: false,
        maxBytes: 1
      });
      await expect(
        rotatingSink.write(createTestAuditEvent("evt_rotating_symlink"))
      ).rejects.toThrow("must not be a symbolic link");
      expect(await readFile(targetPath, "utf8")).toBe("unchanged\n");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "creates private audit directories and files",
    async () => {
      const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
      const auditPath = join(tempDirectory, "private", "audit.jsonl");

      try {
        const auditSink = createFileAuditSink({ path: auditPath });
        await auditSink.write(createTestAuditEvent("evt_private_mode"));

        expect((await stat(dirname(auditPath))).mode & 0o777).toBe(0o700);
        expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    }
  );

  it("rejects audit files with multiple hard links", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "audit.jsonl");

    try {
      await writeFile(auditPath, "existing\n", { encoding: "utf8", mode: 0o600 });
      await link(auditPath, join(tempDirectory, "alias.jsonl"));
      const auditSink = createFileAuditSink({ path: auditPath, createDirectory: false });

      await expect(auditSink.write(createTestAuditEvent("evt_hard_link"))).rejects.toThrow(
        "must not have multiple hard links"
      );
      expect(await readFile(auditPath, "utf8")).toBe("existing\n");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("writes file audit logs while holding an advisory lock", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "locked", "audit.jsonl");

    try {
      const auditSink = createFileAuditSink({
        path: auditPath,
        lock: true
      });

      await auditSink.write(createTestAuditEvent("evt_lock_1"));
      await auditSink.flush?.();

      expect(await readFile(auditPath, "utf8")).toContain("evt_lock_1");
      await expect(readFile(`${auditPath}.lock`, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("times out when the advisory audit lock cannot be acquired", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "locked", "audit.jsonl");
    const lockPath = `${auditPath}.lock`;

    try {
      await mkdir(join(tempDirectory, "locked"), { recursive: true });
      const lockHandle = await open(lockPath, "w");
      const auditSink = createFileAuditSink({
        path: auditPath,
        lock: true,
        lockTimeoutMs: 1
      });

      try {
        await expect(auditSink.write(createTestAuditEvent("evt_lock_timeout"))).rejects.toThrow(
          "Timed out acquiring audit file lock"
        );
      } finally {
        await lockHandle.close();
      }
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("removes stale advisory audit locks", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "locked", "audit.jsonl");
    const lockPath = `${auditPath}.lock`;

    try {
      await mkdir(join(tempDirectory, "locked"), { recursive: true });
      const lockHandle = await open(lockPath, "w");
      await lockHandle.close();
      const oldDate = new Date(Date.now() - 10_000);
      await utimes(lockPath, oldDate, oldDate);

      const auditSink = createFileAuditSink({
        path: auditPath,
        lock: true,
        staleLockMs: 1
      });

      await auditSink.write(createTestAuditEvent("evt_stale_lock"));
      await auditSink.flush?.();

      expect(await readFile(auditPath, "utf8")).toContain("evt_stale_lock");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("does not remove an advisory lock replaced by a newer owner", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const lockPath = join(tempDirectory, "audit.jsonl.lock");

    try {
      const release = await acquireFileLock({
        path: lockPath,
        timeoutMs: 50,
        staleMs: undefined,
        retryMs: 1
      });
      const replacementContents = "replacement-owner\n999\n2026-07-11T00:00:00.000Z\n";
      await writeFile(lockPath, replacementContents, "utf8");

      await release();

      expect(await readFile(lockPath, "utf8")).toBe(replacementContents);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("removes an empty lock file when lock record initialization fails", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const lockPath = join(tempDirectory, "audit.jsonl.lock");
    const initializationError = new Error("synthetic lock record failure");

    try {
      await expect(
        acquireFileLock(
          {
            path: lockPath,
            timeoutMs: 50,
            staleMs: undefined,
            retryMs: 1
          },
          async () => {
            throw initializationError;
          }
        )
      ).rejects.toBe(initializationError);
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rejects file audit writes beyond the configured queue capacity", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "queue", "audit.jsonl");
    const lockPath = `${auditPath}.lock`;

    try {
      await mkdir(join(tempDirectory, "queue"), { recursive: true });
      await writeFile(lockPath, "locked", "utf8");
      const auditSink = createFileAuditSink({
        path: auditPath,
        lock: true,
        lockTimeoutMs: 1000,
        maxQueueSize: 1
      });
      const firstWrite = auditSink.write(createTestAuditEvent("evt_queue_reject_1"));

      try {
        await expect(auditSink.write(createTestAuditEvent("evt_queue_reject_2"))).rejects.toThrow(
          "Audit write queue is full: maxQueueSize=1"
        );
        expect(auditSink.getStats?.()).toEqual({
          pendingWrites: 1,
          droppedWrites: 0
        });
      } finally {
        await rm(lockPath, { force: true });
      }

      await firstWrite;
      await auditSink.flush?.();

      expect(auditSink.getStats?.()).toEqual({
        pendingWrites: 0,
        droppedWrites: 0
      });
      const content = await readFile(auditPath, "utf8");
      expect(content).toContain("evt_queue_reject_1");
      expect(content).not.toContain("evt_queue_reject_2");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("drops newest file audit writes when the bounded queue is full", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-audit-"));
    const auditPath = join(tempDirectory, "queue", "audit.jsonl");
    const lockPath = `${auditPath}.lock`;

    try {
      await mkdir(join(tempDirectory, "queue"), { recursive: true });
      await writeFile(lockPath, "locked", "utf8");
      const auditSink = createFileAuditSink({
        path: auditPath,
        lock: true,
        lockTimeoutMs: 1000,
        maxQueueSize: 1,
        queueOverflowPolicy: "dropNewest"
      });
      const firstWrite = auditSink.write(createTestAuditEvent("evt_queue_drop_1"));

      try {
        await auditSink.write(createTestAuditEvent("evt_queue_drop_2"));
        expect(auditSink.getStats?.()).toEqual({
          pendingWrites: 1,
          droppedWrites: 1
        });
      } finally {
        await rm(lockPath, { force: true });
      }

      await firstWrite;
      await auditSink.flush?.();

      expect(auditSink.getStats?.()).toEqual({
        pendingWrites: 0,
        droppedWrites: 1
      });
      const content = await readFile(auditPath, "utf8");
      expect(content).toContain("evt_queue_drop_1");
      expect(content).not.toContain("evt_queue_drop_2");
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
    expect(() =>
      createFileAuditSink({ path: "audit.jsonl", lock: true, lockTimeoutMs: -1 })
    ).toThrow("lockTimeoutMs must be a non-negative integer");
    expect(() => createFileAuditSink({ path: "audit.jsonl", maxQueueSize: 0 })).toThrow(
      "maxQueueSize must be greater than 0"
    );
    expect(() =>
      createFileAuditSink({
        path: "audit.jsonl",
        queueOverflowPolicy: "dropOldest" as never
      })
    ).toThrow("queueOverflowPolicy must be reject or dropNewest");
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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
