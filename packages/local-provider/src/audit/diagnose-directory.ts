import type { BigIntStats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import { chainInteger, verifyAuditChainRecord } from "./audit-chain.js";
import { assertOwnedFile, missing, readChainMetadata } from "./chain-files.js";
import { parseChainManifest, sameCheckpoint, type ChainManifest } from "./chain-manifest.js";
import { readChainLines } from "./read-chain-lines.js";

export interface DiagnosticLimits {
  readonly maxBytes?: number;
  readonly maxRecordBytes?: number;
  readonly maxRecords?: number;
  readonly maxEntries?: number;
  readonly signal?: AbortSignal;
}
type IssueCode =
  | "READ_FAILED"
  | "UNSAFE_DIRECTORY"
  | "ENTRY_LIMIT"
  | "MANIFEST_MISSING"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_INVALID"
  | "UNREFERENCED_SEGMENTS"
  | "TEMPORARY_FILES"
  | "UNEXPECTED_ENTRIES"
  | "SEGMENT_UNREADABLE"
  | "SEGMENT_SIZE_MISMATCH"
  | "UNCOMMITTED_TAIL"
  | "CHAIN_INVALID"
  | "VERIFICATION_LIMIT";
interface Issue {
  readonly code: IssueCode;
  readonly segmentIndex?: number;
}
export interface AuditDirectoryDiagnostic {
  readonly status: "valid" | "empty" | "busy" | "changed" | "issues";
  readonly consistentSnapshot: false;
  readonly checkpointAuthenticated: false;
  readonly lockPresent: boolean | null;
  readonly manifestPresent: boolean | null;
  readonly directoryEntries: number;
  readonly segments: number | null;
  readonly recordsVerified: number;
  readonly unreferencedSegments: number | null;
  readonly temporaryFiles: number;
  readonly unexpectedEntries: number;
  readonly issues: readonly Issue[];
}
const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;
const segmentName = /^segment-[1-9][0-9]*\.jsonl$/;

// An unlocked observation, never recovery or an atomic evidence snapshot.
export async function diagnoseAuditDirectory(
  directory: string,
  options: DiagnosticLimits = {}
): Promise<AuditDirectoryDiagnostic> {
  const maxBytes = chainInteger(options.maxBytes ?? 256 * 1024 * 1024, 1, 1024 * 1024 * 1024);
  const maxRecordBytes = chainInteger(options.maxRecordBytes ?? 1024 * 1024, 1, 16 * 1024 * 1024);
  const maxRecords = chainInteger(options.maxRecords ?? 100_000, 0, 10_000_000);
  const maxEntries = chainInteger(options.maxEntries ?? 512, 1, 10_000);
  const signal = options.signal;
  const path = join(directory, "manifest.json");
  const lock = `${path}.lock`;
  const entries = new Set<string>();
  const issues: Issue[] = [];
  let lockPresent: boolean | null = null,
    manifestPresent: boolean | null = null;
  let segments: number | null = null,
    unreferencedSegments: number | null = null;
  let recordsVerified = 0,
    temporaryFiles = 0,
    unexpectedEntries = 0;
  let directoryBefore: BigIntStats | undefined, manifestBefore: BigIntStats | undefined;
  let code: IssueCode = "READ_FAILED",
    segmentIndex: number | undefined;
  let changed = false;
  let directoryValidated = false;
  try {
    signal?.throwIfAborted();
    directoryBefore = await lstat(directory, { bigint: true });
    code = "UNSAFE_DIRECTORY";
    if (
      !directoryBefore.isDirectory() ||
      directoryBefore.isSymbolicLink() ||
      (process.geteuid !== undefined && directoryBefore.uid !== BigInt(process.geteuid()))
    )
      throw new Error();
    directoryValidated = true;
    code = "READ_FAILED";
    // The directory iterator closes on completion, early return and thrown limits.
    for await (const entry of await opendir(directory)) {
      signal?.throwIfAborted();
      code = "ENTRY_LIMIT";
      if (entries.size >= maxEntries) throw new Error();
      entries.add(entry.name);
      code = "READ_FAILED";
    }
    code = "READ_FAILED";
    manifestPresent = entries.has("manifest.json");
    lockPresent = await present(lock);
    if (!lockPresent) {
      temporaryFiles = [...entries].filter(
        (name) => name.startsWith(".chain-") && name.endsWith(".tmp")
      ).length;
      unexpectedEntries = [...entries].filter(
        (name) =>
          name !== "manifest.json" &&
          name !== "manifest.json.lock" &&
          !segmentName.test(name) &&
          !(name.startsWith(".chain-") && name.endsWith(".tmp"))
      ).length;
      if (temporaryFiles > 0) issues.push({ code: "TEMPORARY_FILES" });
      if (unexpectedEntries > 0) issues.push({ code: "UNEXPECTED_ENTRIES" });
      if (manifestPresent) {
        code = "MANIFEST_UNREADABLE";
        manifestBefore = await lstat(path, { bigint: true });
        const raw = await readChainMetadata(path, true);
        code = "MANIFEST_INVALID";
        const state = parseChainManifest(raw);
        segments = state.segments.length;
        const referenced = new Set(state.segments.map((segment) => segment.file));
        unreferencedSegments = [...entries].filter(
          (name) => segmentName.test(name) && !referenced.has(name)
        ).length;
        if (unreferencedSegments > 0) issues.push({ code: "UNREFERENCED_SEGMENTS" });
        await verifySegments(state);
      } else if (entries.size > 0) issues.push({ code: "MANIFEST_MISSING" });
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (code === "MANIFEST_UNREADABLE" && error instanceof SyntaxError) code = "MANIFEST_INVALID";
    issues.push({ code, ...(segmentIndex === undefined ? {} : { segmentIndex }) });
  }
  // Recheck even after a read/verification failure: a concurrent writer can make
  // that failure transient. Never label a detected live change as corruption.
  if (directoryValidated && directoryBefore !== undefined) {
    try {
      signal?.throwIfAborted();
      if (!sameFile(directoryBefore, await lstat(directory, { bigint: true }))) changed = true;
      if (
        manifestBefore !== undefined &&
        !sameFile(manifestBefore, await lstat(path, { bigint: true }))
      )
        changed = true;
      lockPresent = (await present(lock)) || lockPresent === true;
    } catch {
      signal?.throwIfAborted();
      changed = true;
    }
  }
  signal?.throwIfAborted();
  const status = lockPresent
    ? "busy"
    : changed
      ? "changed"
      : issues.length > 0
        ? "issues"
        : manifestPresent
          ? "valid"
          : "empty";
  return Object.freeze({
    status,
    consistentSnapshot: false,
    checkpointAuthenticated: false,
    lockPresent,
    manifestPresent,
    directoryEntries: entries.size,
    segments,
    recordsVerified,
    unreferencedSegments,
    temporaryFiles,
    unexpectedEntries,
    issues: Object.freeze(
      (status === "busy" || status === "changed" ? [] : issues).map((issue) => Object.freeze(issue))
    )
  });

  async function verifySegments(state: ChainManifest): Promise<void> {
    let current = state.segments[0]?.start ?? state.initial;
    const budget = { remaining: maxBytes };
    for (const [index, segment] of state.segments.entries()) {
      segmentIndex = index;
      signal?.throwIfAborted();
      code = "SEGMENT_UNREADABLE";
      const segmentPath = join(directory, segment.file);
      const before = await lstat(segmentPath, { bigint: true });
      try {
        assertOwnedFile(before);
        code =
          index === state.segments.length - 1 && before.size > BigInt(segment.size)
            ? "UNCOMMITTED_TAIL"
            : "SEGMENT_SIZE_MISMATCH";
        if (before.size !== BigInt(segment.size)) throw new Error();
        code = "VERIFICATION_LIMIT";
        if (before.size > BigInt(budget.remaining)) throw new Error();
        for await (const line of readChainLines(segmentPath, budget, maxRecordBytes)) {
          signal?.throwIfAborted();
          code = "VERIFICATION_LIMIT";
          if (recordsVerified >= maxRecords) throw new Error();
          code = "CHAIN_INVALID";
          current = verifyAuditChainRecord(JSON.parse(line), current, { maxRecordBytes });
          recordsVerified++;
          code = "SEGMENT_UNREADABLE";
        }
        code = "CHAIN_INVALID";
        if (!sameCheckpoint(current, segment.head)) throw new Error();
        code = "SEGMENT_UNREADABLE";
      } finally {
        try {
          if (!sameFile(before, await lstat(segmentPath, { bigint: true }))) changed = true;
        } catch {
          changed = true;
        }
      }
    }
    segmentIndex = undefined;
  }
}

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}
