import { resolve } from "node:path";
import { loadFlagSnapshotFile, resolveSnapshotFileFormat } from "../flags/snapshot-file.js";
import type { SnapshotFileFormat } from "../public-types.js";

export interface CliIo {
  readonly cwd: string;
  readonly packageVersion?: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

interface ValidateCommandOptions {
  readonly filePath: string;
  readonly format: SnapshotFileFormat;
  readonly json: boolean;
}

export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.stdout(helpText());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    io.stdout(`${io.packageVersion ?? "unknown"}\n`);
    return 0;
  }

  if (command !== "validate") {
    return usageError(io, `Unknown command: ${command}`);
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(validateHelpText());
    return 0;
  }

  const parsed = parseValidateArgs(rest);
  if (typeof parsed === "string") {
    return usageError(io, parsed);
  }

  return validateSnapshotFile(parsed, io);
}

function parseValidateArgs(args: readonly string[]): ValidateCommandOptions | string {
  let filePath: string | undefined;
  let format: SnapshotFileFormat = "auto";
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--format") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return "--format requires one of: auto, json, yaml";
      }
      const parsedFormat = parseFormat(value);
      if (parsedFormat === undefined) {
        return `Unsupported format: ${value}`;
      }
      format = parsedFormat;
      index += 1;
      continue;
    }

    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      const parsedFormat = parseFormat(value);
      if (parsedFormat === undefined) {
        return `Unsupported format: ${value}`;
      }
      format = parsedFormat;
      continue;
    }

    if (arg.startsWith("-")) {
      return `Unknown option: ${arg}`;
    }

    if (filePath !== undefined) {
      return "validate accepts exactly one file path";
    }

    filePath = arg;
  }

  if (filePath === undefined) {
    return "validate requires a file path";
  }

  return {
    filePath,
    format,
    json
  };
}

async function validateSnapshotFile(options: ValidateCommandOptions, io: CliIo): Promise<number> {
  const resolvedPath = resolve(io.cwd, options.filePath);

  try {
    const resolvedFormat = resolveSnapshotFileFormat(resolvedPath, options.format);
    const snapshot = await loadFlagSnapshotFile(resolvedPath, { format: options.format });
    const flagCount = Object.keys(snapshot.flags).length;

    if (options.json) {
      io.stdout(
        `${JSON.stringify({
          ok: true,
          path: options.filePath,
          format: resolvedFormat,
          requestedFormat: options.format,
          schemaVersion: snapshot.schemaVersion,
          flags: flagCount
        })}\n`
      );
      return 0;
    }

    io.stdout(
      `OK ${options.filePath} schemaVersion=${snapshot.schemaVersion} flags=${flagCount} format=${resolvedFormat}\n`
    );
    return 0;
  } catch (error) {
    io.stderr(`Invalid flag snapshot: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseFormat(value: string): SnapshotFileFormat | undefined {
  if (value === "auto" || value === "json" || value === "yaml") {
    return value;
  }

  return undefined;
}

function usageError(io: CliIo, message: string): number {
  io.stderr(`Usage error: ${message}\n\n${helpText()}`);
  return 2;
}

function helpText(): string {
  return `Usage:
  openfeature-local-provider validate <file> [--format auto|json|yaml] [--json]
  openfeature-local-provider --version
  openfeature-local-provider --help

Commands:
  validate  Load and validate a local JSON or YAML flag snapshot.
`;
}

function validateHelpText(): string {
  return `Usage:
  openfeature-local-provider validate <file> [--format auto|json|yaml] [--json]

Options:
  --format auto|json|yaml  Override extension-based format detection.
  --json                   Print a machine-readable validation summary.
`;
}
