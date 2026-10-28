import { resolve } from "node:path";
import type { FlagSnapshot } from "../core-types.js";
import { captureSnapshotInput } from "../flags/capture-snapshot-input.js";
import { validateFlagSnapshot } from "../flags/validate-snapshot.js";
import { DiagnosticReadError, readDiagnosticText } from "../sources/diagnostic-file.js";
import { sourceInteger } from "../sources/source-policy.js";
import type { CliIo } from "./run.js";

export const IMPORT_FLAGD_HELP = `Usage:
  openfeature-local-provider import-flagd <file> [--emit-snapshot] [--max-bytes <bytes>]

Inspect a static flagd JSON file; default JSON report contains no names or values.
Only ENABLED flags with homogeneous variants and explicit existing defaults are supported.
Targeting, metadata, disabled flags, absent defaults and unknown fields are rejected.
--emit-snapshot prints the complete sensitive v2 configuration ONLY on success.
No files are written. Exit 0: supported; 1: rejected/unreadable; 2: invalid arguments.
`;

type Conversion =
  | { readonly ok: true; readonly snapshot: FlagSnapshot }
  | { readonly ok: false; readonly code: string; readonly flagIndex?: number };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// JSON text only: capture applies existing byte/node/depth budgets before conversion.
function convert(text: string): Conversion {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, code: "INVALID_JSON" };
  }
  try {
    input = captureSnapshotInput(input);
  } catch {
    return { ok: false, code: "INPUT_LIMIT" };
  }
  if (!record(input) || !record(input.flags)) return { ok: false, code: "INVALID_ROOT" };
  if (Object.keys(input).some((key) => key !== "flags" && key !== "$schema"))
    return { ok: false, code: "UNSUPPORTED_ROOT_FIELD" };
  if (Object.hasOwn(input, "$schema") && input.$schema !== "https://flagd.dev/schema/v0/flags.json")
    return { ok: false, code: "UNSUPPORTED_SCHEMA" };
  const flags: Record<string, unknown> = Object.create(null);
  let flagIndex = 0;
  for (const [key, flag] of Object.entries(input.flags)) {
    const reject = (code: string): Conversion => ({ ok: false, code, flagIndex });
    if (!record(flag)) return reject("INVALID_FLAG");
    if (Object.keys(flag).some((field) => !["state", "variants", "defaultVariant"].includes(field)))
      return reject("UNSUPPORTED_FLAG_FIELD");
    if (flag.state !== "ENABLED") return reject("UNSUPPORTED_STATE");
    if (!record(flag.variants) || Object.keys(flag.variants).length === 0)
      return reject("INVALID_VARIANTS");
    if (
      typeof flag.defaultVariant !== "string" ||
      !Object.hasOwn(flag.variants, flag.defaultVariant)
    )
      return reject("EXPLICIT_DEFAULT_REQUIRED");
    const values = Object.values(flag.variants);
    const type = typeof values[0];
    if (
      !["boolean", "string", "number", "object"].includes(type) ||
      values.some((value) => value === null || typeof value !== type)
    )
      return reject("INCOMPATIBLE_VARIANT_TYPES");
    flags[key] = { type, variants: flag.variants, defaultVariant: flag.defaultVariant };
    flagIndex += 1;
  }
  try {
    return { ok: true, snapshot: validateFlagSnapshot({ schemaVersion: 2, flags }) };
  } catch {
    return { ok: false, code: "LOCAL_SCHEMA_REJECTED" };
  }
}

export async function runFlagdImport(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(IMPORT_FLAGD_HELP);
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
    for (let index = 0; index < rest.length; index += 1) {
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
    io.stderr(`Usage error: invalid flagd import arguments\n\n${IMPORT_FLAGD_HELP}`);
    return 2;
  }
  let result: Conversion;
  try {
    result = convert((await readDiagnosticText(file, maxBytes)).text);
  } catch (error) {
    result = { ok: false, code: error instanceof DiagnosticReadError ? error.code : "READ_FAILED" };
  }
  if (!result.ok) {
    const report = `${JSON.stringify(result)}\n`;
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
            sourceFormat: "flagd-static-v0",
            schemaVersion: 2,
            flagCount: Object.keys(result.snapshot.flags).length
          }
    )}\n`
  );
  return 0;
}
