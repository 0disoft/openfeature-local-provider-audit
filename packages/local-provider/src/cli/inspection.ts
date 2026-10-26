import { resolve } from "node:path";
import { createSnapshotHash } from "../audit/audit-event.js";
import { createIndexedEnvOverrides } from "../env/indexed-overrides.js";
import { evaluateFlag } from "../evaluator/evaluate.js";
import { explainEvaluation } from "../evaluator/explain.js";
import { flagValueMatchesType, isFlagValue } from "../evaluator/type-guards.js";
import { loadFlagSnapshotFile, readFileWithinLimit } from "../flags/snapshot-file.js";
import type {
  EvaluationRequest,
  EvaluationResult,
  ReplayOverrideInput,
  SnapshotFileFormat
} from "../public-types.js";
import type { CliIo } from "./run.js";

export const INSPECTION_HELP = `Usage:
  openfeature-local-provider evaluate <snapshot> --request <request.json> [--format auto|json|yaml]
  openfeature-local-provider explain <snapshot> --request <request.json> [--format auto|json|yaml]
  openfeature-local-provider simulate <snapshot> --requests <requests.json> [--format auto|json|yaml]
  openfeature-local-provider compare <before> <after> --requests <requests.json> [--format auto|json|yaml]

All output is JSON. Evaluation/explanation omits values and raw context.
Simulation/comparison emits aggregate counts only. No process environment is read.
Compare accepts --max-changed-values-percent and --max-changed-decisions-percent
(0..100, up to four decimal places). Policy rejection exits 3; errors still exit 1.
--diagnostics adds a safe error code and optional zero-based requestIndex to stderr.
`;

interface InspectionOptions {
  readonly files: readonly string[];
  readonly input: string;
  readonly format: SnapshotFileFormat;
  readonly diagnostics: boolean;
  readonly maxChangedValuesPercent?: number;
  readonly maxChangedDecisionsPercent?: number;
}

export async function runInspection(
  command: string,
  args: readonly string[],
  io: CliIo
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(INSPECTION_HELP);
    return 0;
  }
  const options = parseOptions(command, args);
  if (!options) {
    io.stderr(`Usage error: invalid inspection arguments\n\n${INSPECTION_HELP}`);
    return 2;
  }
  let failureCode = "SNAPSHOT_INPUT";
  try {
    const snapshots = [];
    for (const file of options.files)
      snapshots.push(await loadFlagSnapshotFile(resolve(io.cwd, file), { format: options.format }));
    const before = snapshots[0];
    if (!before) throw new Error("Missing snapshot");
    failureCode = "REQUEST_INPUT";
    const raw: unknown = JSON.parse(
      await readFileWithinLimit(resolve(io.cwd, options.input), 10 * 1024 * 1024, "utf8")
    );
    failureCode = "REQUEST_LIMIT";
    assertBoundedJson(raw);
    const beforeOverrides = createIndexedEnvOverrides(before);
    if (command === "evaluate" || command === "explain") {
      const request = parseIndexedRequest(raw, undefined, beforeOverrides);
      const explanation = explainEvaluation(before, request);
      io.stdout(`${JSON.stringify(explanation)}\n`);
      return explanation.errorCode === undefined ? 0 : 1;
    }
    if (!Array.isArray(raw) || !raw.length || raw.length > 10_000)
      throw new Error("Invalid request count");
    failureCode = "INSPECTION_FAILED";
    // Retain decisions, not every request's full snapshot-wide override state.
    const baseline = raw.map((entry, index) =>
      evaluateFlag(before, parseIndexedRequest(entry, index, beforeOverrides))
    );
    const after = snapshots[1];
    if (!after) {
      io.stdout(
        `${JSON.stringify({ total: raw.length, snapshotHash: createSnapshotHash(before), ...summarize(baseline) })}\n`
      );
      return baseline.some((result) => result.errorCode !== undefined) ? 1 : 0;
    }
    const afterOverrides = createIndexedEnvOverrides(after);
    const candidate = raw.map((entry, index) =>
      evaluateFlag(after, parseIndexedRequest(entry, index, afterOverrides))
    );
    let changedValues = 0;
    let changedDecisions = 0;
    const valuesEqual = createValueComparer();
    for (let i = 0; i < baseline.length; i++) {
      const previous = baseline[i];
      const next = candidate[i];
      if (!previous || !next) throw new Error("Mismatched comparison");
      if (!valuesEqual(previous.value, next.value)) changedValues++;
      if (
        canonical([
          previous.variant ?? null,
          previous.ruleId ?? null,
          previous.reason,
          previous.source,
          previous.errorCode ?? null,
          previous.bucket ?? null,
          previous.schedule ?? null
        ]) !==
        canonical([
          next.variant ?? null,
          next.ruleId ?? null,
          next.reason,
          next.source,
          next.errorCode ?? null,
          next.bucket ?? null,
          next.schedule ?? null
        ])
      )
        changedDecisions++;
    }
    const policy = comparisonPolicy(options, raw.length, changedValues, changedDecisions);
    io.stdout(
      `${JSON.stringify({
        total: raw.length,
        ...(policy !== undefined ? { policy } : {}),
        changedValues,
        changedDecisions,
        before: { snapshotHash: createSnapshotHash(before), ...summarize(baseline) },
        after: { snapshotHash: createSnapshotHash(after), ...summarize(candidate) }
      })}\n`
    );
    if ([...baseline, ...candidate].some((result) => result.errorCode !== undefined)) return 1;
    return policy?.passed === false ? 3 : 0;
  } catch (cause) {
    io.stderr(
      "Local inspection failed: check snapshot/request schema, file access, size and limits. Inputs and values are omitted.\n"
    );
    if (options.diagnostics) {
      const indexed = cause instanceof InspectionRequestError;
      io.stderr(
        `${JSON.stringify({
          error: {
            code: indexed ? "REQUEST_SCHEMA" : failureCode,
            ...(indexed && cause.requestIndex !== undefined
              ? { requestIndex: cause.requestIndex }
              : {})
          }
        })}\n`
      );
    }
    return 1;
  }
}

function parseOptions(command: string, args: readonly string[]): InspectionOptions | undefined {
  const files: string[] = [];
  let input: string | undefined;
  let format: SnapshotFileFormat = "auto";
  let diagnostics = false;
  let maxChangedValuesPercent: number | undefined;
  let maxChangedDecisionsPercent: number | undefined;
  const inputOption = command === "evaluate" || command === "explain" ? "--request" : "--requests";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) return undefined;
    if (arg === "--diagnostics") {
      if (diagnostics) return undefined;
      diagnostics = true;
    } else if (
      arg === "--max-changed-values-percent" ||
      arg === "--max-changed-decisions-percent"
    ) {
      if (command !== "compare") return undefined;
      const value = args[++i];
      if (value === undefined || value.length > 16 || !/^\d+(?:\.\d{1,4})?$/.test(value))
        return undefined;
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent > 100) return undefined;
      if (arg === "--max-changed-values-percent") {
        if (maxChangedValuesPercent !== undefined) return undefined;
        maxChangedValuesPercent = percent;
      } else {
        if (maxChangedDecisionsPercent !== undefined) return undefined;
        maxChangedDecisionsPercent = percent;
      }
    } else if (arg === inputOption) {
      if (input !== undefined) return undefined;
      input = args[++i];
      if (!input || input.startsWith("-")) return undefined;
    } else if (arg === "--format") {
      const next = args[++i];
      if (next !== "auto" && next !== "json" && next !== "yaml") return undefined;
      format = next;
    } else if (arg === "--json") {
      /* JSON is already the only output format. */
    } else if (arg.startsWith("-")) return undefined;
    else files.push(arg);
  }
  if (!input || files.length !== (command === "compare" ? 2 : 1)) return undefined;
  return {
    files,
    input,
    format,
    diagnostics,
    ...(maxChangedValuesPercent !== undefined ? { maxChangedValuesPercent } : {}),
    ...(maxChangedDecisionsPercent !== undefined ? { maxChangedDecisionsPercent } : {})
  };
}

const PERCENT_SCALE = 10_000;
function comparisonPolicy(
  options: InspectionOptions,
  total: number,
  values: number,
  decisions: number
) {
  const { maxChangedValuesPercent, maxChangedDecisionsPercent } = options;
  if (maxChangedValuesPercent === undefined && maxChangedDecisionsPercent === undefined)
    return undefined;
  const violations: string[] = [];
  if (
    maxChangedValuesPercent !== undefined &&
    values * 100 * PERCENT_SCALE > Math.round(maxChangedValuesPercent * PERCENT_SCALE) * total
  )
    violations.push("CHANGED_VALUES_LIMIT");
  if (
    maxChangedDecisionsPercent !== undefined &&
    decisions * 100 * PERCENT_SCALE > Math.round(maxChangedDecisionsPercent * PERCENT_SCALE) * total
  )
    violations.push("CHANGED_DECISIONS_LIMIT");
  return {
    passed: violations.length === 0,
    ...(maxChangedValuesPercent !== undefined ? { maxChangedValuesPercent } : {}),
    ...(maxChangedDecisionsPercent !== undefined ? { maxChangedDecisionsPercent } : {}),
    violations
  };
}

class InspectionRequestError extends Error {
  constructor(readonly requestIndex: number | undefined) {
    super("Invalid inspection request.");
  }
}
function parseIndexedRequest(
  raw: unknown,
  index: number | undefined,
  createOverrides: ReturnType<typeof createIndexedEnvOverrides>
): EvaluationRequest {
  try {
    return parseRequest(raw, createOverrides);
  } catch {
    throw new InspectionRequestError(index);
  }
}

function parseRequest(
  raw: unknown,
  createOverrides: ReturnType<typeof createIndexedEnvOverrides>
): EvaluationRequest {
  if (
    !record(raw) ||
    !onlyKeys(raw, [
      "flagKey",
      "expectedType",
      "defaultValue",
      "targetingKey",
      "context",
      "overrides",
      "evaluationTime"
    ])
  )
    throw new Error("Invalid request");
  if (
    typeof raw.flagKey !== "string" ||
    !raw.flagKey.trim() ||
    !Object.hasOwn(raw, "defaultValue") ||
    !isFlagValue(raw.defaultValue)
  )
    throw new Error("Invalid request fields");
  const type = raw.expectedType;
  if (type !== "boolean" && type !== "string" && type !== "number" && type !== "object")
    throw new Error("Invalid expected type");
  if (
    !(type === "object" && raw.defaultValue === null) &&
    !flagValueMatchesType(raw.defaultValue, type)
  )
    throw new Error("Invalid default type");
  if (
    raw.targetingKey !== undefined &&
    (typeof raw.targetingKey !== "string" || raw.targetingKey.length > 4096)
  )
    throw new Error("Invalid targeting key");
  if (raw.context !== undefined && !record(raw.context)) throw new Error("Invalid context");
  let overrideInput: ReplayOverrideInput | undefined;
  if (raw.overrides !== undefined) {
    if (!record(raw.overrides) || !onlyKeys(raw.overrides, ["overridesJson", "env"]))
      throw new Error("Invalid overrides");
    if (
      raw.overrides.overridesJson !== undefined &&
      typeof raw.overrides.overridesJson !== "string"
    )
      throw new Error("Invalid override JSON");
    if (
      raw.overrides.env !== undefined &&
      (!record(raw.overrides.env) ||
        !Object.values(raw.overrides.env).every((value) => typeof value === "string"))
    )
      throw new Error("Invalid override env");
    overrideInput = raw.overrides as ReplayOverrideInput;
  }
  const context = raw.context as Record<string, unknown> | undefined;
  if (
    raw.evaluationTime !== undefined &&
    (!Number.isSafeInteger(raw.evaluationTime) || (raw.evaluationTime as number) < 0)
  )
    throw new Error("Invalid evaluation time");
  const contextKey = context?.targetingKey;
  const targetingKey =
    raw.targetingKey ?? (typeof contextKey === "string" ? contextKey : undefined);
  return {
    flagKey: raw.flagKey,
    ...(raw.evaluationTime !== undefined ? { evaluationTime: raw.evaluationTime as number } : {}),
    defaultValue: raw.defaultValue,
    expectedType: type,
    ...(context ? { context } : {}),
    ...(targetingKey !== undefined ? { targetingKey } : {}),
    ...(overrideInput
      ? {
          overrides: createOverrides({
            ...overrideInput,
            env: overrideInput.env ?? {}
          })
        }
      : {})
  } as EvaluationRequest;
}

function summarize(results: readonly EvaluationResult[]) {
  const groups = new Map<
    string,
    {
      flagKey: string;
      reason: string;
      variant?: string;
      ruleId?: string;
      errorCode?: string;
      count: number;
    }
  >();
  let errors = 0;
  for (const result of results) {
    if (result.errorCode) errors++;
    const key = JSON.stringify([
      result.flagKey,
      result.reason,
      result.variant,
      result.ruleId,
      result.errorCode
    ]);
    const group = groups.get(key);
    if (group) group.count++;
    else
      groups.set(key, {
        flagKey: result.flagKey,
        reason: result.reason,
        ...(result.variant !== undefined ? { variant: result.variant } : {}),
        ...(result.ruleId !== undefined ? { ruleId: result.ruleId } : {}),
        ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
        count: 1
      });
  }
  return { errors, groups: [...groups.values()] };
}

const MAX_INSPECTION_JSON_NODES = 100_000;

function assertBoundedJson(value: unknown): void {
  const stack = [{ value, depth: 0 }];
  let nodes = 1;
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    if (next.depth > 32) throw new Error("Input complexity limit");
    if (next.value !== null && typeof next.value === "object") {
      // Parsed JSON arrays are dense: each slot consumes a node, before copying values.
      if (Array.isArray(next.value) && next.value.length > MAX_INSPECTION_JSON_NODES - nodes)
        throw new Error("Input complexity limit");
      const children = Object.values(next.value);
      nodes += children.length;
      if (nodes > MAX_INSPECTION_JSON_NODES) throw new Error("Input complexity limit");
      for (const child of children) stack.push({ value: child, depth: next.depth + 1 });
    }
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

// This cache belongs to one synchronous comparison of CLI-owned values. Store
// booleans per object pair, without retaining serialized payloads or global state.
function createValueComparer() {
  const compared = new WeakMap<object, WeakMap<object, boolean>>();
  return (left: unknown, right: unknown): boolean => {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
      return canonical(left) === canonical(right);
    let matches = compared.get(left);
    const cached = matches?.get(right);
    if (cached !== undefined) return cached;
    const equal = canonical(left) === canonical(right);
    if (matches === undefined) {
      matches = new WeakMap();
      compared.set(left, matches);
    }
    matches.set(right, equal);
    return equal;
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
