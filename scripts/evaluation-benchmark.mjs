import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createFileAuditSink,
  createLocalProvider,
  createReloadableLocalProvider,
  evaluateFlag,
  parseJsonFlagSnapshot,
  watchFlagSnapshotFile
} from "../packages/local-provider/dist/index.js";

const args = process.argv.slice(2);
let iterations = 2_000;
let output;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--iterations") iterations = Number(args[++i]);
  else if (args[i] === "--output" && args[i + 1]) output = args[++i];
  else
    throw new Error(
      "Usage: evaluation-benchmark.mjs [--iterations <100..50000>] [--output <file>]"
    );
}
if (!Number.isInteger(iterations) || iterations < 100 || iterations > 50_000) {
  throw new Error("iterations must be an integer from 100 through 50000");
}

const directory = await mkdtemp(join(tmpdir(), "local-provider-evaluation-"));
const logger = {
  warn: () => {
    throw new Error("Unexpected provider warning");
  }
};
const warnings = [];
logger.warn = (message) => warnings.push(message);
const cases = [];
let watcher;
try {
  for (const flagCount of [1, 1_000]) {
    const snapshot = makeSnapshot(flagCount);
    const request = { flagKey: "flag.0", expectedType: "boolean", defaultValue: false };
    for (let i = 0; i < 500; i += 1) evaluateFlag(snapshot, request);
    cases.push(
      await measure(`pure-static-${flagCount}-flags`, () => evaluateFlag(snapshot, request))
    );
    const rollout = makeSnapshot(flagCount, true);
    cases.push(
      await measure(`pure-rollout-${flagCount}-flags`, () =>
        evaluateFlag(rollout, { ...request, targetingKey: "synthetic-subject" })
      )
    );
  }

  for (const audit of ["off", "nonBlocking", "blocking"]) {
    const sink =
      audit === "off"
        ? undefined
        : createFileAuditSink({
            path: join(directory, `${audit}.jsonl`),
            maxQueueSize: iterations + 1
          });
    const provider = createLocalProvider({
      snapshot: makeSnapshot(1_000),
      env: {},
      auditSink: sink,
      ...(audit === "off" ? {} : { auditWriteMode: audit })
    });
    const measurement = await measure(`provider-audit-${audit}`, () =>
      provider.resolveBooleanEvaluation("flag.0", false, {}, logger)
    );
    const beforeFlush = sink?.getStats?.();
    const started = performance.now();
    await sink?.flush?.();
    cases.push({
      ...measurement,
      flushMs: performance.now() - started,
      beforeFlush,
      afterFlush: sink?.getStats?.()
    });
    await provider.onClose?.();
  }

  const snapshot = makeSnapshot(1);
  const file = join(directory, "flags.json");
  await writeFile(file, JSON.stringify(snapshot));
  const provider = createReloadableLocalProvider({ snapshot, env: {} });
  let resolveUpdate;
  const updated = new Promise((resolve) => {
    resolveUpdate = resolve;
  });
  watcher = await watchFlagSnapshotFile({
    path: file,
    debounceMs: 10,
    consistencyPollIntervalMs: 50,
    onSnapshot(next) {
      provider.updateSnapshot(next);
      if (next.flags["flag.0"].defaultVariant === "off") resolveUpdate();
    },
    onError(error) {
      warnings.push(String(error));
    }
  });
  const replacement = join(directory, "replacement.json");
  const next = JSON.parse(JSON.stringify(snapshot));
  next.flags["flag.0"].defaultVariant = "off";
  await writeFile(replacement, JSON.stringify(next));
  const started = performance.now();
  await rename(replacement, file);
  let timeout;
  try {
    await Promise.race([
      updated,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Snapshot propagation timed out")), 10_000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const propagationMs = performance.now() - started;
  const resolved = await provider.resolveBooleanEvaluation("flag.0", true, {}, logger);
  if (resolved.value !== false || warnings.length > 0) {
    throw new Error(`Benchmark correctness failed: ${JSON.stringify(warnings)}`);
  }
  await provider.onClose?.();
  const report = {
    schemaVersion: 1,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    iterations,
    capturedAt: new Date().toISOString(),
    cases,
    propagation: { milliseconds: propagationMs, debounceMs: 10, consistencyPollIntervalMs: 50 },
    notes:
      "Sequential per-call wall-time samples; heap/RSS deltas are not peaks. Informational, not a CI gate. File sink queue sized to avoid saturation; use benchmark:audit-queue for stalls."
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, json);
  console.log(json);
} finally {
  watcher?.close();
  await rm(directory, { recursive: true, force: true });
}

function makeSnapshot(count, rollout = false) {
  return parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion: 1,
      flags: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `flag.${i}`,
          {
            type: "boolean",
            defaultVariant: "on",
            variants: { on: true, off: false },
            ...(rollout ? { rollout: [{ variant: "on", percentage: 50, seed: "baseline" }] } : {})
          }
        ])
      )
    })
  );
}

async function measure(name, operation) {
  globalThis.gc?.();
  const before = process.memoryUsage();
  const samples = [];
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    const result = operation();
    const resolved = result instanceof Promise ? await result : result;
    if (resolved.errorCode) throw new Error(`Evaluation failed in ${name}`);
    samples.push((performance.now() - start) * 1_000);
  }
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage();
  samples.sort((a, b) => a - b);
  return {
    name,
    elapsedMs,
    p50Microseconds: samples[Math.floor(samples.length * 0.5)],
    p95Microseconds: samples[Math.floor(samples.length * 0.95)],
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss
  };
}
