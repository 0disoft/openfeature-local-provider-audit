import { resolve } from "node:path";
import type { SnapshotVerificationOptions } from "../public-types.js";
import { diagnoseSnapshotJournal } from "../sources/diagnose-snapshot-journal.js";
import { readDiagnosticText } from "../sources/diagnostic-file.js";
import { sourceInteger } from "../sources/source-policy.js";
import type { CliIo } from "./run.js";

export const SNAPSHOT_DIAGNOSIS_HELP = `Usage:
  openfeature-local-provider snapshot-diagnose <journal>
    [--verification <public-verification.json>] [--max-bytes <bytes>] [--max-entries <count>]

Read-only JSON observation; never repairs, initializes, removes locks or activates history.
Without verification settings, only structure is checked; no signature/replay protection is claimed.
Stop writers before diagnosis. Public verification settings must contain no private keys.
`;

export async function runSnapshotDiagnosis(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(SNAPSHOT_DIAGNOSIS_HELP);
    return 0;
  }
  try {
    const [first, ...rest] = args;
    if (!first || first.startsWith("-")) throw new Error();
    let verificationPath: string | undefined;
    let maxBytes = 16 * 1024 * 1024,
      maxEntries = 512;
    const seen = new Set<string>();
    for (let index = 0; index < rest.length; index += 2) {
      const key = rest[index],
        value = rest[index + 1];
      if (!key || !value || value.startsWith("-") || seen.has(key)) throw new Error();
      seen.add(key);
      if (key === "--verification") verificationPath = resolve(io.cwd, value);
      else {
        if (!/^[0-9]+$/.test(value)) throw new Error();
        if (key === "--max-bytes")
          maxBytes = sourceInteger(key, Number(value), 1, 100 * 1024 * 1024);
        else if (key === "--max-entries") maxEntries = sourceInteger(key, Number(value), 1, 10000);
        else throw new Error();
      }
    }
    const verification = verificationPath
      ? parseVerification((await readDiagnosticText(verificationPath, 256 * 1024)).text)
      : undefined;
    const result = await diagnoseSnapshotJournal(resolve(io.cwd, first), {
      maxBytes,
      maxEntries,
      ...(verification ? { verification } : {})
    });
    io.stdout(`${JSON.stringify(result)}\n`);
    return ["valid", "structureOnly", "missing"].includes(result.status) ? 0 : 1;
  } catch {
    io.stderr(
      `Usage error: invalid snapshot diagnosis arguments or public verification settings\n\n${SNAPSHOT_DIAGNOSIS_HELP}`
    );
    return 2;
  }
}

function parseVerification(text: string): SnapshotVerificationOptions {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "audience",
    "trustedKeys",
    "minSequence",
    "maxAgeMs",
    "maxLifetimeMs",
    "clockSkewMs",
    "maxBytes"
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    Object.entries(record).some(
      ([key, value]) => key !== "audience" && key !== "trustedKeys" && typeof value !== "number"
    ) ||
    typeof record.audience !== "string" ||
    !record.trustedKeys ||
    typeof record.trustedKeys !== "object" ||
    Array.isArray(record.trustedKeys) ||
    !Object.values(record.trustedKeys).every((key) => typeof key === "string")
  )
    throw new Error();
  return record as unknown as SnapshotVerificationOptions;
}
