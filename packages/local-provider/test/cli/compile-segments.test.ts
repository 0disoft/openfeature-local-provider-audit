import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { createSnapshotHash } from "../../src/audit/audit-event.js";
import {
  evaluateFlag,
  explainEvaluation,
  parseJsonFlagSnapshot,
  replayEvaluationFixture
} from "../../src/index.js";
import {
  evaluateFlag as coreEvaluate,
  parseJsonFlagSnapshot as coreParse
} from "../../src/core.js";

const leaf = { attribute: ["tenant"], op: "eq", value: "private-pilot" };
const ref = (segment: string) => ({ segment });
const flag = (when: unknown, id = "pilot") => ({
  type: "boolean",
  variants: { on: true, off: false },
  defaultVariant: "off",
  rules: [{ id, when, variant: "on" }]
});
const input = (
  segments: object = { pilot: leaf },
  flags: object = { feature: flag(ref("pilot")) }
) => ({
  authoringVersion: 1,
  segments,
  snapshot: { schemaVersion: 2, flags }
});
async function run(value: unknown, args: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "compile-segments-"));
  const file = join(cwd, "authoring.json");
  let stdout = "",
    stderr = "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text !== undefined) await writeFile(file, text);
    const before = text === undefined ? undefined : await stat(file, { bigint: true });
    const code = await runCli(["compile-segments", "authoring.json", ...args], {
      cwd,
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      }
    });
    if (before) {
      expect(await readFile(file, "utf8")).toBe(text);
      const after = await stat(file, { bigint: true });
      expect([after.ino, after.size, after.mtimeNs, after.ctimeNs]).toEqual([
        before.ino,
        before.size,
        before.mtimeNs,
        before.ctimeNs
      ]);
    }
    return { code, stdout, stderr };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

it("reuses one predicate across two rules, with inline-equivalent hashes and decisions", async () => {
  const source = input(
    { pilot: leaf, excluded: { not: ref("pilot") } },
    {
      feature: flag(ref("pilot")),
      excluded: flag(ref("excluded"))
    }
  );
  const before = JSON.stringify(source);
  const report = await run(source);
  expect(report.code).toBe(0);
  expect(JSON.parse(report.stdout)).toMatchObject({
    ok: true,
    segmentCount: 2,
    flagCount: 2,
    expansionVisits: 6
  });
  expect(report.stdout + report.stderr).not.toContain("private-pilot");
  const emitted = await run(source, ["--emit-snapshot"]);
  expect(emitted.code).toBe(0);
  const compiled = parseJsonFlagSnapshot(emitted.stdout);
  const inline = parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion: 2,
      flags: {
        feature: flag(leaf),
        excluded: flag({ not: leaf })
      }
    })
  );
  expect(createSnapshotHash(compiled)).toBe(createSnapshotHash(inline));
  expect(JSON.stringify(source)).toBe(before);
  expect(emitted.stdout).not.toContain('"segments"');
  for (const context of [{ tenant: "private-pilot" }, { tenant: "other" }, {}, { tenant: null }]) {
    for (const flagKey of ["feature", "excluded"]) {
      const request = { flagKey, expectedType: "boolean" as const, defaultValue: false, context };
      expect(evaluateFlag(compiled, request)).toEqual(evaluateFlag(inline, request));
      expect(coreEvaluate(coreParse(emitted.stdout), request)).toEqual(
        evaluateFlag(inline, request)
      );
      expect(explainEvaluation(compiled, request)).toEqual(explainEvaluation(inline, request));
    }
  }
  const request = {
    flagKey: "feature",
    expectedType: "boolean" as const,
    defaultValue: false,
    context: { tenant: "private-pilot" }
  };
  expect(
    replayEvaluationFixture({
      schemaVersion: 1,
      name: "compiled",
      snapshot: compiled,
      request,
      expected: {
        value: true,
        variant: "on",
        reason: "TARGETING_MATCH",
        source: "file",
        ruleId: "pilot"
      }
    }).passed
  ).toBe(true);
  const changed = await run(input({ pilot: { ...leaf, value: "changed" } }), ["--emit-snapshot"]);
  expect(createSnapshotHash(parseJsonFlagSnapshot(changed.stdout))).not.toBe(
    createSnapshotHash(compiled)
  );
});

it.each([
  ["REFERENCE_CYCLE", input({ pilot: ref("pilot") })],
  ["REFERENCE_CYCLE", input({ pilot: ref("other"), other: ref("pilot") })],
  ["REFERENCE_CYCLE", input({ pilot: leaf, unused: ref("unused") })],
  ["MISSING_REFERENCE", input({ pilot: ref("missing") })],
  ["MISSING_REFERENCE", input({ pilot: leaf, unused: ref("missing") })],
  ["INVALID_REFERENCE", input({ pilot: leaf }, { feature: flag({ segment: "pilot", not: leaf }) })],
  ["INVALID_REFERENCE", input({ pilot: leaf }, { feature: flag(ref("")) })],
  ["INVALID_CONDITION", input({ pilot: { any: [] } })],
  ["SOURCE_REJECTED", input({ pilot: { ...leaf, op: "unknown" } })],
  ["INVALID_ENVELOPE", { ...input(), authoringVersion: 2 }],
  ["INVALID_ENVELOPE", { ...input(), extra: 1 }],
  ["INVALID_ENVELOPE", { ...input(), segments: [] }],
  ["INVALID_ENVELOPE", { ...input(), snapshot: { schemaVersion: 1, flags: {} } }],
  ["INVALID_FLAG", input({}, { feature: null })],
  ["SOURCE_REJECTED", input({}, { feature: { ...flag(leaf), defaultVariant: "missing" } })],
  ["INVALID_RULE", input({}, { feature: { ...flag(leaf), rules: [null] } })],
  ["INVALID_JSON", "{ private invalid"],
  ["INPUT_LIMIT", '{"private":1e400}']
])("rejects %s without partial or sensitive output", async (code, source) => {
  const report = await run(source);
  expect(report.code).toBe(1);
  expect(JSON.parse(report.stdout).code).toBe(code);
  expect(report.stdout).not.toContain("private");
  const emit = await run(source, ["--emit-snapshot"]);
  expect(emit.stdout).toBe("");
  expect(JSON.parse(emit.stderr).code).toBe(code);
});

it("counts reference hops against depth and rejects exponential fanout before expansion", async () => {
  const definitions = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`s${i}`, i ? ref(`s${i - 1}`) : leaf])
  );
  expect((await run(input(definitions, { feature: flag(ref("s6")) }))).code).toBe(0);
  expect(
    JSON.parse((await run(input(definitions, { feature: flag(ref("s7")) }))).stdout).code
  ).toBe("CONDITION_LIMIT");
  const fanout = { pilot: leaf, twice: { all: Array.from({ length: 20 }, () => ref("pilot")) } };
  expect((await run(input(fanout, { feature: flag(ref("twice")) }))).code).toBe(0);
  expect(
    JSON.parse(
      (
        await run(
          input({ ...fanout, huge: { all: Array.from({ length: 20 }, () => ref("twice")) } })
        )
      ).stdout
    ).code
  ).toBe("CONDITION_LIMIT");
});

it("enforces exact 64-definition and 10000-total traversal limits", async () => {
  const definitions = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`s${i}`, leaf]));
  expect((await run(input(definitions, {}))).code).toBe(0);
  expect(JSON.parse((await run(input({ ...definitions, overflow: leaf }, {}))).stdout).code).toBe(
    "DEFINITION_LIMIT"
  );
  const nodes100 = {
    all: Array.from({ length: 5 }, (_, i) => ({
      all: Array.from({ length: i ? 19 : 18 }, () => leaf)
    }))
  };
  const large = {
    ...flag(leaf),
    rules: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, when: nodes100, variant: "on" }))
  };
  const report = await run(input({}, { feature: large }));
  expect(report.code).toBe(0);
  expect(JSON.parse(report.stdout).expansionVisits).toBe(10000);
  expect(
    JSON.parse((await run(input({}, { feature: large, overflow: flag(leaf) }))).stdout).code
  ).toBe("EXPANSION_LIMIT");
});

it("resolves prototype-named definitions by own name and preserves variant JSON", async () => {
  const source = input(
    Object.fromEntries([
      ["__proto__", leaf],
      ["n".repeat(128), leaf]
    ]),
    {
      feature: flag(ref("__proto__")),
      payload: {
        type: "object",
        variants: { a: { segment: "ordinary-data" } },
        defaultVariant: "a"
      }
    }
  );
  const result = await run(source, ["--emit-snapshot"]);
  expect(result.code).toBe(0);
  expect(parseJsonFlagSnapshot(result.stdout).flags.payload?.variants.a).toEqual({
    segment: "ordinary-data"
  });
  expect(() => parseJsonFlagSnapshot(JSON.stringify(source))).toThrow();
  expect(JSON.parse((await run(input({ ["n".repeat(129)]: leaf }, {}))).stdout).code).toBe(
    "DEFINITION_LIMIT"
  );
});

it("keeps byte limits and missing-source errors redacted", async () => {
  const source = input();
  const bytes = Buffer.byteLength(JSON.stringify(source));
  expect((await run(source, ["--max-bytes", String(bytes)])).code).toBe(0);
  expect(JSON.parse((await run(source, ["--max-bytes", String(bytes - 1)])).stdout).code).toBe(
    "BYTE_LIMIT"
  );
  expect(JSON.parse((await run(undefined)).stdout).code).toBe("SOURCE_REJECTED");
});
it.each([
  ["--unknown"],
  ["extra"],
  ["--emit-snapshot", "--emit-snapshot"],
  ["--max-bytes"],
  ["--max-bytes", "0"],
  ["--max-bytes", "1.5"],
  ["--max-bytes", "104857601"]
])("rejects invalid usage %j", async (...args) => {
  expect((await run(input(), args)).code).toBe(2);
});
