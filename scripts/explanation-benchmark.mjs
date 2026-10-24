import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { explainEvaluation, parseJsonFlagSnapshot } from "../packages/local-provider/dist/index.js";

// Fixed local CPU workload; excludes parsing, disk and network from timed sections.
const iterations = 200;
const samples = 5;
const results = [];
for (const flagCount of [1, 1_000]) {
  const source = {
    schemaVersion: 1,
    flags: Object.fromEntries(
      Array.from({ length: flagCount }, (_, index) => [
        `flag.${index}`,
        { type: "boolean", variants: { on: true, off: false }, defaultVariant: "on" }
      ])
    )
  };
  const json = JSON.stringify(source);
  const snapshot = parseJsonFlagSnapshot(json);
  const request = { flagKey: "flag.0", expectedType: "boolean", defaultValue: false };
  const expected = explainEvaluation(source, request);
  const entries = Object.entries;
  let traversals = 0;
  Object.entries = (value) => {
    if (value === snapshot) traversals++;
    return entries(value);
  };
  try {
    for (let index = 0; index < iterations; index++) {
      assert.deepEqual(explainEvaluation(snapshot, request), expected);
    }
  } finally {
    Object.entries = entries;
  }
  const timings = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    let actual;
    for (let index = 0; index < iterations; index++) actual = explainEvaluation(snapshot, request);
    timings.push(performance.now() - start);
    assert.deepEqual(actual, expected);
  }
  timings.sort((left, right) => left - right);
  results.push({
    flagCount,
    jsonBytes: Buffer.byteLength(json),
    iterations,
    samples,
    coldSequenceCanonicalizations: traversals,
    medianMs: timings[Math.floor(samples / 2)]
  });
}
console.log(
  JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2)
);
