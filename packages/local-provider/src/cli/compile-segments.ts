import { resolve } from "node:path";
import type { FlagSnapshot } from "../core-types.js";
import { captureSnapshotInput } from "../flags/capture-snapshot-input.js";
import { validateFlagSnapshot } from "../flags/validate-snapshot.js";
import { validateTargetingRules } from "../flags/validate-targeting.js";
import { DiagnosticReadError, readDiagnosticText } from "../sources/diagnostic-file.js";
import { sourceInteger } from "../sources/source-policy.js";
import type { CliIo } from "./run.js";

export const COMPILE_SEGMENTS_HELP = `Usage:
  openfeature-local-provider compile-segments <file> [--emit-snapshot] [--max-bytes <bytes>]

Compile JSON {authoringVersion:1, segments:{name:condition}, snapshot:{schemaVersion:2,flags:{...}}}.
Exact {segment:name} conditions expand before runtime validation. Cycles/missing references reject.
Default JSON report has counts only; --emit-snapshot explicitly prints sensitive complete output.
No files are written. Exit 0: supported; 1: rejected/unreadable; 2: invalid arguments.
`;

const MAX_DEFINITIONS = 64;
const MAX_EXPANSION_VISITS = 10000;
class CompileError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function reject(code: string): never {
  throw new CompileError(code);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function name(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && value.trim().length > 0;
}

// Private authoring boundary: evaluation consumes only the validated expanded snapshot.
function compile(text: string): { snapshot: FlagSnapshot; segmentCount: number; visits: number } {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return reject("INVALID_JSON");
  }
  try {
    input = captureSnapshotInput(input);
  } catch {
    return reject("INPUT_LIMIT");
  }
  if (
    !record(input) ||
    input.authoringVersion !== 1 ||
    !record(input.segments) ||
    !record(input.snapshot) ||
    input.snapshot.schemaVersion !== 2 ||
    !record(input.snapshot.flags) ||
    Object.keys(input).some((key) => !["authoringVersion", "segments", "snapshot"].includes(key))
  )
    return reject("INVALID_ENVELOPE");
  const definitions = new Map(Object.entries(input.segments));
  if (definitions.size > MAX_DEFINITIONS || [...definitions.keys()].some((key) => !name(key)))
    return reject("DEFINITION_LIMIT");
  let total = 0;
  function expand(
    value: unknown,
    budget: { nodes: number },
    depth: number,
    active: Set<string>,
    count: boolean
  ): unknown {
    if (++budget.nodes > 100 || depth > 8) return reject("CONDITION_LIMIT");
    if (count && ++total > MAX_EXPANSION_VISITS) return reject("EXPANSION_LIMIT");
    if (!record(value)) return reject("INVALID_CONDITION");
    if (Object.hasOwn(value, "segment")) {
      if (Object.keys(value).length !== 1 || !name(value.segment))
        return reject("INVALID_REFERENCE");
      if (!definitions.has(value.segment)) return reject("MISSING_REFERENCE");
      if (active.has(value.segment)) return reject("REFERENCE_CYCLE");
      active.add(value.segment);
      try {
        return expand(definitions.get(value.segment), budget, depth + 1, active, count);
      } finally {
        active.delete(value.segment);
      }
    }
    for (const key of ["not", "all", "any"] as const) {
      if (!Object.hasOwn(value, key)) continue;
      if (Object.keys(value).length !== 1) return reject("INVALID_CONDITION");
      if (key === "not") return { not: expand(value.not, budget, depth + 1, active, count) };
      const children = value[key];
      if (!Array.isArray(children) || children.length < 1 || children.length > 20)
        return reject("INVALID_CONDITION");
      return { [key]: children.map((child) => expand(child, budget, depth + 1, active, count)) };
    }
    return value;
  }
  // Validate unused definitions too: broken/cyclic policy must never hide behind lack of use.
  for (const [key, value] of definitions) {
    const when = expand(value, { nodes: 0 }, 1, new Set([key]), false);
    validateTargetingRules(
      [{ id: "definition", when, variant: "selected" }],
      () => true,
      () => undefined
    );
  }
  const flags = Object.fromEntries(
    Object.entries(input.snapshot.flags).map(([key, value]) => {
      if (!record(value)) return reject("INVALID_FLAG");
      if (value.rules === undefined) return [key, value];
      if (!Array.isArray(value.rules) || value.rules.length > 100) return reject("RULE_LIMIT");
      const rules = value.rules.map((rule) => {
        if (!record(rule)) return reject("INVALID_RULE");
        return { ...rule, when: expand(rule.when, { nodes: 0 }, 1, new Set(), true) };
      });
      return [key, { ...value, rules }];
    })
  );
  return {
    snapshot: validateFlagSnapshot({ ...input.snapshot, flags }),
    segmentCount: definitions.size,
    visits: total
  };
}

export async function runSegmentCompilation(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(COMPILE_SEGMENTS_HELP);
    return 0;
  }
  let file: string,
    emit = false,
    maxBytes = 10 * 1024 * 1024;
  try {
    const [first, ...rest] = args;
    if (!first || first.startsWith("-")) throw new Error();
    file = resolve(io.cwd, first);
    const seen = new Set<string>();
    for (let index = 0; index < rest.length; index++) {
      const key = rest[index];
      if (!key || seen.has(key)) throw new Error();
      seen.add(key);
      if (key === "--emit-snapshot") emit = true;
      else if (key === "--max-bytes") {
        const value = rest[++index];
        if (!value || !/^[0-9]+$/.test(value)) throw new Error();
        maxBytes = sourceInteger(key, Number(value), 1, 100 * 1024 * 1024);
      } else throw new Error();
    }
  } catch {
    io.stderr(`Usage error: invalid segment compilation arguments\n\n${COMPILE_SEGMENTS_HELP}`);
    return 2;
  }
  let result: ReturnType<typeof compile>;
  try {
    result = compile((await readDiagnosticText(file, maxBytes)).text);
  } catch (error) {
    const code =
      error instanceof CompileError || error instanceof DiagnosticReadError
        ? error.code
        : "SOURCE_REJECTED";
    const report = `${JSON.stringify({ ok: false, code })}\n`;
    if (emit) io.stderr(report);
    else io.stdout(report);
    return 1;
  }
  io.stdout(
    `${JSON.stringify(
      emit
        ? result.snapshot
        : {
            ok: true,
            schemaVersion: 2,
            segmentCount: result.segmentCount,
            flagCount: Object.keys(result.snapshot.flags).length,
            expansionVisits: result.visits
          }
    )}\n`
  );
  return 0;
}
