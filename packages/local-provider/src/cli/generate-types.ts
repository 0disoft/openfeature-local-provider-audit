import { resolve } from "node:path";
import type { FlagSnapshot } from "../core-types.js";
import { loadFlagSnapshotFile } from "../flags/snapshot-file.js";
import type { SnapshotFileFormat } from "../public-types.js";
import type { CliIo } from "./run.js";

export const GENERATE_TYPES_HELP = `Usage:
  openfeature-local-provider generate-types <file> [--format auto|json|yaml]

Print standalone TypeScript declarations for validated flag keys and declared values.
Redirect stdout to a .d.ts file. Invalid input prints no declarations (exit 1);
invalid arguments exit 2. Object values remain JSON objects/arrays; overrides and
caller defaults make inferred variant literals or object shapes unsafe.
`;

export async function runTypeGeneration(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(GENERATE_TYPES_HELP);
    return 0;
  }
  let file: string | undefined;
  let format: SnapshotFileFormat = "auto";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--format" || argument.startsWith("--format=")) {
      const value = argument === "--format" ? args[++index] : argument.slice("--format=".length);
      if (value !== "auto" && value !== "json" && value !== "yaml") return usageError(io);
      format = value;
    } else if (argument.startsWith("-") || file !== undefined) return usageError(io);
    else file = argument;
  }
  if (file === undefined || file.length === 0) return usageError(io);
  try {
    const snapshot = await loadFlagSnapshotFile(resolve(io.cwd, file), { format });
    io.stdout(generateTypes(snapshot));
    return 0;
  } catch {
    io.stderr("Type generation failed: snapshot is invalid or unreadable.\n");
    return 1;
  }
}

function generateTypes(snapshot: FlagSnapshot): string {
  const entries = Object.entries(snapshot.flags).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const json = entries.some(([, flag]) => flag.type === "object")
    ? "type JsonValue = string | number | boolean | null | { readonly [key: string]: JsonValue } | readonly JsonValue[];\n\n"
    : "";
  const properties = entries.map(([key, flag]) => {
    const quoted = JSON.stringify(key)
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    const type =
      flag.type === "object"
        ? "Readonly<Record<string, JsonValue>> | readonly JsonValue[]"
        : flag.type;
    return `  readonly ${quoted}: ${type};`;
  });
  return `// Generated from a validated snapshot. Regenerate when flag keys or types change.\n// Declared flag values; caller defaults on evaluation errors may widen results.\n${json}export interface FlagValues {\n${properties.join("\n")}\n}\n\nexport type FlagKey = keyof FlagValues;\nexport type FlagValue<K extends FlagKey> = FlagValues[K];\n`;
}

function usageError(io: CliIo): number {
  io.stderr(`Usage error: invalid type generation arguments\n\n${GENERATE_TYPES_HELP}`);
  return 2;
}
