import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  EVALUATION_REASONS,
  EVALUATION_SOURCES,
  createFileAuditSink
} from "../packages/local-provider/dist/index.js";

const DEFAULT_WRITES = 5_000;
const DEFAULT_QUEUE_SIZE = 1_000;
const DEFAULT_STALL_MS = 100;

const options = parseOptions(process.argv.slice(2));
const benchmarkRoot = await mkdtemp(join(tmpdir(), "openfeature-audit-queue-benchmark-"));

try {
  const scenarios = [
    await runScenario({ name: "fast-unbounded", blocked: false }),
    await runScenario({ name: "lock-stalled-unbounded", blocked: true }),
    await runScenario({
      name: "lock-stalled-bounded-reject",
      blocked: true,
      maxQueueSize: options.queueSize,
      queueOverflowPolicy: "reject"
    }),
    await runScenario({
      name: "lock-stalled-bounded-drop-newest",
      blocked: true,
      maxQueueSize: options.queueSize,
      queueOverflowPolicy: "dropNewest"
    })
  ];

  const report = {
    schemaVersion: 1,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version
    },
    parameters: {
      writes: options.writes,
      queueSize: options.queueSize,
      stallMs: options.stallMs
    },
    scenarios
  };

  if (options.output !== undefined) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log("Audit queue benchmark");
    console.log(
      `Node ${process.version} on ${process.platform}/${process.arch}; writes=${options.writes}; queue=${options.queueSize}; stall=${options.stallMs}ms`
    );
    console.table(
      scenarios.map((scenario) => ({
        scenario: scenario.name,
        enqueueMs: scenario.enqueueMs,
        drainMs: scenario.drainMs,
        peakPending: scenario.peakPendingWrites,
        written: scenario.writtenWrites,
        rejected: scenario.rejectedWrites,
        dropped: scenario.droppedWrites,
        heapDeltaKiB: Math.round(scenario.heapDeltaBytes / 1024)
      }))
    );
  }
} finally {
  await rm(benchmarkRoot, { recursive: true, force: true });
}

async function runScenario({ name, blocked, maxQueueSize, queueOverflowPolicy }) {
  const scenarioRoot = join(benchmarkRoot, name);
  const auditPath = join(scenarioRoot, "audit.jsonl");
  const lockPath = `${auditPath}.lock`;
  await mkdir(scenarioRoot, { recursive: true });

  if (blocked) {
    await writeFile(lockPath, "benchmark-owner\n", "utf8");
  }

  const sink = createFileAuditSink({
    path: auditPath,
    ...(blocked
      ? {
          lock: true,
          lockTimeoutMs: options.stallMs + 5_000
        }
      : {}),
    ...(maxQueueSize !== undefined ? { maxQueueSize } : {}),
    ...(queueOverflowPolicy !== undefined ? { queueOverflowPolicy } : {})
  });

  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  let rejectedWrites = 0;
  let failedWrites = 0;

  for (let index = 0; index < options.writes; index += 1) {
    void sink.write(createBenchmarkEvent(index)).catch((error) => {
      if (error instanceof Error && error.message.startsWith("Audit write queue is full:")) {
        rejectedWrites += 1;
      } else {
        failedWrites += 1;
      }
    });
  }

  const enqueuedAt = performance.now();
  if (blocked) {
    await delay(options.stallMs);
  }

  globalThis.gc?.();
  const pressureStats = sink.getStats?.() ?? {
    pendingWrites: 0,
    droppedWrites: 0
  };
  const heapAtPressure = process.memoryUsage().heapUsed;

  if (blocked) {
    await unlink(lockPath);
  }

  const drainStartedAt = performance.now();
  await sink.flush?.();
  await Promise.resolve();
  const completedAt = performance.now();
  const droppedWrites = sink.getStats?.().droppedWrites ?? 0;
  const writtenWrites = await countAuditLines(auditPath);

  if (writtenWrites + rejectedWrites + droppedWrites + failedWrites !== options.writes) {
    throw new Error(`Scenario ${name} did not account for every requested write.`);
  }

  return {
    name,
    writesRequested: options.writes,
    maxQueueSize: maxQueueSize ?? null,
    queueOverflowPolicy: queueOverflowPolicy ?? null,
    lockEnabled: blocked,
    stallMs: blocked ? options.stallMs : 0,
    enqueueMs: roundMilliseconds(enqueuedAt - startedAt),
    drainMs: roundMilliseconds(completedAt - drainStartedAt),
    totalMs: roundMilliseconds(completedAt - startedAt),
    peakPendingWrites: pressureStats.pendingWrites,
    writtenWrites,
    rejectedWrites,
    droppedWrites,
    failedWrites,
    heapDeltaBytes: heapAtPressure - heapBefore
  };
}

function createBenchmarkEvent(index) {
  return {
    schemaVersion: 1,
    eventId: `benchmark-${index}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    providerName: "benchmark",
    flagKey: "benchmark.enabled",
    requestedType: "boolean",
    reason: EVALUATION_REASONS.STATIC,
    source: EVALUATION_SOURCES.FILE,
    snapshotHash: "0".repeat(64),
    context: {
      targetingKeyPresent: false,
      keyMode: "count",
      keys: [],
      keyCount: 0,
      redacted: true
    }
  };
}

async function countAuditLines(path) {
  const contents = await readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return contents === "" ? 0 : contents.split("\n").length - 1;
}

function parseOptions(args) {
  const parsed = {
    writes: DEFAULT_WRITES,
    queueSize: DEFAULT_QUEUE_SIZE,
    stallMs: DEFAULT_STALL_MS,
    json: false,
    output: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--json") {
      parsed.json = true;
      continue;
    }

    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }

    if (argument === "--writes") {
      parsed.writes = parsePositiveInteger(value, argument);
    } else if (argument === "--queue-size") {
      parsed.queueSize = parsePositiveInteger(value, argument);
    } else if (argument === "--stall-ms") {
      parsed.stallMs = parsePositiveInteger(value, argument);
    } else if (argument === "--output") {
      if (value.trim() === "") {
        throw new Error(`${argument} must not be empty.`);
      }
      parsed.output = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }

  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}
