import { readChainLines } from "../audit/read-chain-lines.js";
import { resolve } from "node:path";
import {
  chainInteger,
  createAuditChainCheckpoint,
  verifyAuditChain,
  verifyAuditChainRecord
} from "../audit/audit-chain.js";
import { readFileWithinLimit } from "../flags/snapshot-file.js";
import type { AuditChainCheckpoint } from "../public-types.js";
import type { CliIo } from "./run.js";

export const AUDIT_CHAIN_HELP = `Usage:
  openfeature-local-provider audit-verify <oldest.jsonl> ... <current.jsonl>
    (--chain-id <id> | --start <checkpoint.json>) [--expect-head <trusted.json>]
    [--max-bytes <bytes>] [--max-record-bytes <bytes>] [--max-records <count>]

Read-only JSON summary. Trusted checkpoint storage/authentication is caller-owned.
No expected head means no claim against tail truncation or whole-log rewrite.
`;

interface Options {
  files: string[];
  chainId?: string;
  start?: string;
  expected?: string;
  maxBytes: number;
  maxRecordBytes: number;
  maxRecords: number;
}

export async function runAuditVerification(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(AUDIT_CHAIN_HELP);
    return 0;
  }
  let options: Options;
  try {
    options = parseOptions(args);
  } catch {
    io.stderr(`Usage error: invalid audit verification arguments\n\n${AUDIT_CHAIN_HELP}`);
    return 2;
  }
  try {
    const readCheckpoint = async (path: string) => {
      const value = JSON.parse(
        await readFileWithinLimit(resolve(io.cwd, path), 16 * 1024, "utf8")
      ) as AuditChainCheckpoint;
      return verifyAuditChain([], { start: value }).head;
    };
    let head =
      options.start !== undefined
        ? await readCheckpoint(options.start)
        : createAuditChainCheckpoint(options.chainId ?? "");
    const expected =
      options.expected === undefined ? undefined : await readCheckpoint(options.expected);
    const budget = { remaining: options.maxBytes };
    let records = 0;
    for (const file of options.files) {
      for await (const line of readChainLines(
        resolve(io.cwd, file),
        budget,
        options.maxRecordBytes
      )) {
        if (records >= options.maxRecords) throw new Error();
        head = verifyAuditChainRecord(JSON.parse(line), head, {
          maxRecordBytes: options.maxRecordBytes
        });
        records++;
      }
    }
    const checked = verifyAuditChain([], {
      start: head,
      ...(expected !== undefined ? { expectedHead: expected } : {})
    });
    io.stdout(
      `${JSON.stringify({ ok: true, records, head: checked.head, checkpointMatched: checked.checkpointMatched })}\n`
    );
    return 0;
  } catch {
    io.stderr("Audit chain verification failed.\n");
    return 1;
  }
}

function parseOptions(args: readonly string[]): Options {
  const result: Options = {
    files: [],
    maxBytes: 256 * 1024 * 1024,
    maxRecordBytes: 1024 * 1024,
    maxRecords: 100_000
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) throw new Error();
    if (!arg.startsWith("-")) {
      result.files.push(arg);
      continue;
    }
    if (seen.has(arg)) throw new Error();
    seen.add(arg);
    const value = args[++index];
    if (value === undefined || value.startsWith("-")) throw new Error();
    if (arg === "--chain-id") result.chainId = value;
    else if (arg === "--start") result.start = value;
    else if (arg === "--expect-head") result.expected = value;
    else if (arg === "--max-bytes")
      result.maxBytes = chainInteger(Number(value), 1, 1024 * 1024 * 1024);
    else if (arg === "--max-record-bytes")
      result.maxRecordBytes = chainInteger(Number(value), 1, 16 * 1024 * 1024);
    else if (arg === "--max-records")
      result.maxRecords = chainInteger(Number(value), 0, 10_000_000);
    else throw new Error();
  }
  if (
    result.files.length === 0 ||
    result.files.length > 128 ||
    (result.chainId === undefined) === (result.start === undefined)
  )
    throw new Error();
  return result;
}
