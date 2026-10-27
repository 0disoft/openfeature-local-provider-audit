import { resolve } from "node:path";
import { chainInteger } from "../audit/audit-chain.js";
import { diagnoseAuditDirectory, type DiagnosticLimits } from "../audit/diagnose-directory.js";
import type { CliIo } from "./run.js";

export const AUDIT_DIAGNOSIS_HELP = `Usage:
  openfeature-local-provider audit-diagnose <directory>
    [--max-bytes <bytes>] [--max-record-bytes <bytes>]
    [--max-records <count>] [--max-entries <count>]

Read-only JSON observation. Never repairs, deletes, takes locks or authenticates a checkpoint.
Stop writers for diagnosis; this is not an atomic evidence snapshot.
`;

export async function runAuditDiagnosis(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(AUDIT_DIAGNOSIS_HELP);
    return 0;
  }
  let directory: string;
  const limits: { -readonly [K in keyof DiagnosticLimits]: DiagnosticLimits[K] } = {};
  try {
    const [first, ...rest] = args;
    if (first === undefined || first.startsWith("-")) throw new Error();
    directory = resolve(io.cwd, first);
    const seen = new Set<string>();
    for (let index = 0; index < rest.length; index += 2) {
      const key = rest[index],
        value = rest[index + 1];
      if (key === undefined || value === undefined || seen.has(key) || !/^[0-9]+$/.test(value))
        throw new Error();
      seen.add(key);
      const numeric = Number(value);
      switch (key) {
        case "--max-bytes":
          limits.maxBytes = chainInteger(numeric, 1, 1024 * 1024 * 1024);
          break;
        case "--max-record-bytes":
          limits.maxRecordBytes = chainInteger(numeric, 1, 16 * 1024 * 1024);
          break;
        case "--max-records":
          limits.maxRecords = chainInteger(numeric, 0, 10_000_000);
          break;
        case "--max-entries":
          limits.maxEntries = chainInteger(numeric, 1, 10_000);
          break;
        default:
          throw new Error();
      }
    }
  } catch {
    io.stderr(`Usage error: invalid audit diagnosis arguments\n\n${AUDIT_DIAGNOSIS_HELP}`);
    return 2;
  }
  const result = await diagnoseAuditDirectory(directory, limits);
  io.stdout(`${JSON.stringify(result)}\n`);
  return result.status === "valid" || result.status === "empty" ? 0 : 1;
}
