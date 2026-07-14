import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  renderBenchmarkMarkdown,
  summarizeBenchmarkDirectory
} from "./audit-queue-benchmark-summary.mjs";

test("summarizes identical reports in expected platform order", async () => {
  await withReports(async (root) => {
    const summary = await summarizeBenchmarkDirectory(root);

    assert.equal(summary.schemaVersion, 1);
    assert.deepEqual(
      summary.platforms.map((report) => report.environment.platform),
      ["linux", "darwin", "win32"]
    );
    assert.match(renderBenchmarkMarkdown(summary), /Timing and heap values are sampled/);
    assert.match(renderBenchmarkMarkdown(summary), /lock-stalled-bounded-drop-newest/);
  });
});

test("rejects a missing platform report", async () => {
  await withReports(
    async (root) => {
      await assert.rejects(
        summarizeBenchmarkDirectory(root),
        /Expected 3 benchmark reports, found 2/
      );
    },
    ["linux", "darwin"]
  );
});

test("rejects mismatched benchmark parameters", async () => {
  await withReports(async (root) => {
    const windowsPath = join(root, "win32", "result.json");
    const report = createReport("win32");
    report.parameters.stallMs = 200;
    await writeReport(windowsPath, report);

    await assert.rejects(
      summarizeBenchmarkDirectory(root),
      /Benchmark parameters differ for win32/
    );
  });
});

test("rejects unaccounted writes", async () => {
  await withReports(async (root) => {
    const windowsPath = join(root, "win32", "result.json");
    const report = createReport("win32");
    report.scenarios[0].writtenWrites = 9;
    await writeReport(windowsPath, report);

    await assert.rejects(summarizeBenchmarkDirectory(root), /accounted writes must be 10, got 9/);
  });
});

test("rejects failed writes even when all writes are accounted", async () => {
  await withReports(async (root) => {
    const windowsPath = join(root, "win32", "result.json");
    const report = createReport("win32");
    report.scenarios[0].writtenWrites = 9;
    report.scenarios[0].failedWrites = 1;
    await writeReport(windowsPath, report);

    await assert.rejects(summarizeBenchmarkDirectory(root), /failedWrites must be 0, got 1/);
  });
});

async function withReports(callback, platforms = ["linux", "darwin", "win32"]) {
  const root = await mkdtemp(join(tmpdir(), "audit-queue-summary-test-"));
  try {
    for (const platform of platforms) {
      await writeReport(join(root, platform, "result.json"), createReport(platform));
    }
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report)}\n`, "utf8");
}

function createReport(platform) {
  return {
    schemaVersion: 1,
    environment: {
      platform,
      architecture: "x64",
      node: "v24.0.0"
    },
    parameters: {
      writes: 10,
      queueSize: 3,
      stallMs: 100
    },
    scenarios: [
      createScenario("fast-unbounded", 10),
      createScenario("lock-stalled-unbounded", 10, { lockEnabled: true, stallMs: 100 }),
      createScenario("lock-stalled-bounded-reject", 3, {
        maxQueueSize: 3,
        queueOverflowPolicy: "reject",
        lockEnabled: true,
        stallMs: 100,
        rejectedWrites: 7
      }),
      createScenario("lock-stalled-bounded-drop-newest", 3, {
        maxQueueSize: 3,
        queueOverflowPolicy: "dropNewest",
        lockEnabled: true,
        stallMs: 100,
        droppedWrites: 7
      })
    ]
  };
}

function createScenario(name, writtenWrites, overrides = {}) {
  return {
    name,
    writesRequested: 10,
    maxQueueSize: null,
    queueOverflowPolicy: null,
    lockEnabled: false,
    stallMs: 0,
    enqueueMs: 1,
    drainMs: 2,
    totalMs: 3,
    peakPendingWrites: writtenWrites,
    writtenWrites,
    rejectedWrites: 0,
    droppedWrites: 0,
    failedWrites: 0,
    heapDeltaBytes: 1024,
    ...overrides
  };
}
