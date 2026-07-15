import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createBenchmarkPlan } from "./audit-queue-benchmark-plan.mjs";
import {
  renderBenchmarkMarkdown,
  summarizeBenchmarkDirectory
} from "./audit-queue-benchmark-summary.mjs";

test("summarizes repeated v2 reports and calculates median and maximum metrics", async () => {
  await withReports(defaultReports(), async (root) => {
    const summary = await summarizeBenchmarkDirectory(root);

    assert.equal(summary.schemaVersion, 2);
    assert.equal(summary.profile, "decision");
    assert.equal(summary.reportCount, 6);
    assert.equal(summary.scenarioResultCount, 24);
    assert.equal(summary.samples[0].repetitions.length, 2);
    assert.deepEqual(
      summary.samples[0].repetitions[0].platforms.map((report) => report.environment.platform),
      ["linux", "darwin", "win32"]
    );
    assert.deepEqual(summary.samples[0].statistics[0].metrics.enqueueMs, {
      min: 1,
      median: 1.5,
      max: 2
    });
    assert.match(renderBenchmarkMarkdown(summary), /Enqueue p50\/max ms/);
  });
});

test("continues to summarize legacy v1 reports", async () => {
  const reports = ["linux", "darwin", "win32"].map((platform) =>
    createReport(platform, { schemaVersion: 1 })
  );
  await withReports(reports, async (root) => {
    const summary = await summarizeBenchmarkDirectory(root);
    assert.equal(summary.profile, "legacy");
    assert.equal(summary.samples[0].id, "legacy-10-3-100");
  });
});

test("rejects a missing platform in any repetition", async () => {
  const reports = defaultReports().filter(
    (report) => !(report.sample.repetition === 2 && report.environment.platform === "win32")
  );
  await withReports(reports, async (root) => {
    await assert.rejects(
      summarizeBenchmarkDirectory(root),
      /platform set mismatch for short repetition 2: missing=win32/
    );
  });
});

test("rejects mismatched parameters within one sample", async () => {
  const reports = defaultReports();
  reports.at(-1).parameters.stallMs = 200;
  await withReports(reports, async (root) => {
    await assert.rejects(
      summarizeBenchmarkDirectory(root),
      /Benchmark parameters differ within sample short/
    );
  });
});

test("rejects unaccounted writes", async () => {
  const reports = defaultReports();
  reports[0].scenarios[0].writtenWrites = 9;
  await withReports(reports, async (root) => {
    await assert.rejects(summarizeBenchmarkDirectory(root), /accounted writes must be 10, got 9/);
  });
});

test("rejects failed writes even when all writes are accounted", async () => {
  const reports = defaultReports();
  reports[0].scenarios[0].writtenWrites = 9;
  reports[0].scenarios[0].failedWrites = 1;
  await withReports(reports, async (root) => {
    await assert.rejects(summarizeBenchmarkDirectory(root), /failedWrites must be 0, got 1/);
  });
});

test("rejects mixed profiles", async () => {
  const reports = defaultReports();
  reports.at(-1).sample.profile = "custom";
  await withReports(reports, async (root) => {
    await assert.rejects(summarizeBenchmarkDirectory(root), /mixed profiles: custom,decision/);
  });
});

test("creates fixed quick and decision profile matrices", () => {
  const quick = createBenchmarkPlan("quick");
  assert.equal(quick.matrix.include.length, 3);
  assert.deepEqual(new Set(quick.matrix.include.map((entry) => entry.stallMs)), new Set([100]));

  const decision = createBenchmarkPlan("decision");
  assert.equal(decision.matrix.include.length, 27);
  assert.deepEqual(
    new Set(decision.matrix.include.map((entry) => entry.stallMs)),
    new Set([1_000, 5_000, 30_000])
  );
  assert.deepEqual(
    new Set(decision.matrix.include.map((entry) => entry.repetition)),
    new Set([1, 2, 3])
  );
});

test("creates and validates a custom profile matrix", () => {
  const custom = createBenchmarkPlan("custom", {
    writes: 123,
    queueSize: 45,
    stallMs: 678
  });
  assert.equal(custom.matrix.include.length, 3);
  assert.equal(custom.matrix.include[0].writes, 123);
  assert.throws(
    () => createBenchmarkPlan("custom", { writes: 0, queueSize: 45, stallMs: 678 }),
    /custom writes must be a positive integer/
  );
});

function defaultReports() {
  const reports = [];
  for (const repetition of [1, 2]) {
    for (const platform of ["linux", "darwin", "win32"]) {
      reports.push(createReport(platform, { repetition }));
    }
  }
  return reports;
}

async function withReports(reports, callback) {
  const root = await mkdtemp(join(tmpdir(), "audit-queue-summary-test-"));
  try {
    for (const report of reports) {
      const sample = report.sample?.id ?? "legacy";
      const repetition = report.sample?.repetition ?? 1;
      const platform = report.environment.platform;
      await writeReport(join(root, `${sample}-r${repetition}-${platform}`, "result.json"), report);
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

function createReport(platform, options = {}) {
  const schemaVersion = options.schemaVersion ?? 2;
  const repetition = options.repetition ?? 1;
  return {
    schemaVersion,
    ...(schemaVersion === 2
      ? {
          sample: {
            profile: "decision",
            id: "short",
            repetition
          }
        }
      : {}),
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
      createScenario("fast-unbounded", 10, repetition),
      createScenario("lock-stalled-unbounded", 10, repetition, {
        lockEnabled: true,
        stallMs: 100
      }),
      createScenario("lock-stalled-bounded-reject", 3, repetition, {
        maxQueueSize: 3,
        queueOverflowPolicy: "reject",
        lockEnabled: true,
        stallMs: 100,
        rejectedWrites: 7
      }),
      createScenario("lock-stalled-bounded-drop-newest", 3, repetition, {
        maxQueueSize: 3,
        queueOverflowPolicy: "dropNewest",
        lockEnabled: true,
        stallMs: 100,
        droppedWrites: 7
      })
    ]
  };
}

function createScenario(name, writtenWrites, metric, overrides = {}) {
  return {
    name,
    writesRequested: 10,
    maxQueueSize: null,
    queueOverflowPolicy: null,
    lockEnabled: false,
    stallMs: 0,
    enqueueMs: metric,
    drainMs: metric * 2,
    totalMs: metric * 3,
    peakPendingWrites: writtenWrites,
    writtenWrites,
    rejectedWrites: 0,
    droppedWrites: 0,
    failedWrites: 0,
    heapDeltaBytes: metric * 1024,
    ...overrides
  };
}
