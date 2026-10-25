import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { createAuditEvent, serializeAuditEvent } from "../../src/audit/audit-event.js";
import { createFileAuditSink, serializeProcessWrite } from "../../src/audit/audit-sink.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { staticSnapshot } from "../fixtures.js";

it.skipIf(process.platform !== "win32")(
  "serializes case aliases until an earlier operation finishes",
  async () => {
    const path = resolve("case-queue.jsonl");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const first = serializeProcessWrite(path, async () => {
      started.push("first");
      await gate;
    });
    const second = serializeProcessWrite(path.toUpperCase(), async () => {
      started.push("second");
    });
    await Promise.resolve();
    const during = [...started];
    release();
    await Promise.all([first, second]);
    expect(during).toEqual(["first"]);
    expect(started).toEqual(["first", "second"]);
  }
);

it.skipIf(process.platform !== "win32")(
  "releases the shared case-alias queue after failure",
  async () => {
    const path = resolve("failed-case-queue.jsonl");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error("storage failure");
    const started: string[] = [];
    const first = serializeProcessWrite(path, async () => {
      started.push("first");
      await gate;
      throw failure;
    });
    const second = serializeProcessWrite(path.toUpperCase(), async () => {
      started.push("second");
    });
    await Promise.resolve();
    const during = [...started];
    release();
    const results = await Promise.allSettled([first, second]);
    await serializeProcessWrite(path, async () => {
      started.push("third");
    });
    expect(during).toEqual(["first"]);
    expect(results).toEqual([
      { status: "rejected", reason: failure },
      { status: "fulfilled", value: undefined }
    ]);
    expect(started).toEqual(["first", "second", "third"]);
  }
);

it.skipIf(process.platform !== "win32")(
  "preserves rotation bounds for two case-alias file sinks",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "of-case-queue-"));
    try {
      const request = {
        flagKey: "checkout.enabled",
        expectedType: "boolean" as const,
        defaultValue: false
      };
      const base = createAuditEvent({
        snapshot: staticSnapshot,
        providerName: "case-test",
        request,
        result: evaluateFlag(staticSnapshot, request),
        eventId: "000"
      });
      const maxBytes = Buffer.byteLength(serializeAuditEvent(base));
      const sinks = ["events.jsonl", "EVENTS.JSONL"].map((file) =>
        createFileAuditSink({ path: join(directory, file), maxBytes, maxFiles: 8 })
      );
      const records = Array.from({ length: 8 }, (_, index) => ({
        ...base,
        eventId: String(index).padStart(3, "0")
      }));
      await Promise.all(records.map((event, index) => sinks[index % 2]?.writeConfirmed?.(event)));
      await Promise.all(sinks.map((sink) => sink.flush?.()));
      const files = await readdir(directory);
      const stored: string[] = [];
      for (const file of files) {
        const content = await readFile(join(directory, file), "utf8");
        expect(Buffer.byteLength(content)).toBeLessThanOrEqual(maxBytes);
        stored.push(
          ...content
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line).eventId)
        );
      }
      expect(files).toHaveLength(8);
      expect(stored.sort()).toEqual(records.map((event) => event.eventId));
    } finally {
      expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-case-queue-"))).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  }
);
it("keeps case-distinct POSIX queue keys independent", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  if (original === undefined) throw new Error("Missing platform descriptor");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  let operations: Promise<void>[];
  try {
    Object.defineProperty(process, "platform", { ...original, value: "linux" });
    operations = [
      serializeProcessWrite("/case-distinct/events.jsonl", async () => {
        started.push("lower");
        await gate;
      }),
      serializeProcessWrite("/case-distinct/EVENTS.JSONL", async () => {
        started.push("upper");
      })
    ];
  } finally {
    // Restore before any asynchronous callbacks run; these operations perform no I/O.
    Object.defineProperty(process, "platform", original);
  }
  await Promise.resolve();
  const during = [...started];
  release();
  await Promise.all(operations);
  expect(during).toEqual(["lower", "upper"]);
});
