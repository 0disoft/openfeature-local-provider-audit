import type { BigIntStats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { SnapshotVerificationOptions, SnapshotVerifier } from "../public-types.js";
import { sourceInteger } from "./source-policy.js";
import { createHistoricalSnapshotVerifier, createSnapshotVerifier } from "./signed-snapshot.js";
import { parseSnapshotJournal } from "./snapshot-journal.js";
import { DiagnosticReadError, readDiagnosticText, sameDiagnosticFile } from "./diagnostic-file.js";

interface Options {
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly verification?: SnapshotVerificationOptions;
  readonly signal?: AbortSignal;
}
type IssueCode =
  | "READ_FAILED"
  | "UNSAFE_DIRECTORY"
  | "UNSAFE_FILE"
  | "BYTE_LIMIT"
  | "ENTRY_LIMIT"
  | "JOURNAL_INVALID"
  | "TEMPORARY_FILES"
  | "HEAD_UNVERIFIABLE"
  | "HISTORY_UNVERIFIABLE"
  | "HISTORY_ORDER_INVALID"
  | "HEAD_NOT_ACTIVATABLE";
interface Issue {
  readonly code: IssueCode;
  readonly artifactIndex?: number;
}
export interface SnapshotJournalDiagnostic {
  readonly status: "valid" | "structureOnly" | "missing" | "busy" | "changed" | "issues";
  readonly consistentSnapshot: false;
  readonly rollbackProtected: false;
  readonly lockPresent: boolean | null;
  readonly journalPresent: boolean | null;
  readonly artifacts: number | null;
  readonly temporaryFiles: number;
  readonly headAuthenticated: boolean | null;
  readonly activationEligible: boolean | null;
  readonly authenticatedArtifacts: number;
  readonly issues: readonly Issue[];
}

export async function diagnoseSnapshotJournal(
  path: string,
  options: Options = {}
): Promise<SnapshotJournalDiagnostic> {
  const maxBytes = sourceInteger(
    "maxBytes",
    options.maxBytes ?? 16 * 1024 * 1024,
    1,
    100 * 1024 * 1024
  );
  const maxEntries = sourceInteger("maxEntries", options.maxEntries ?? 512, 1, 10000);
  const historical = options.verification && createHistoricalSnapshotVerifier(options.verification);
  const fresh = options.verification && createSnapshotVerifier(options.verification);
  const directory = dirname(path),
    lock = `${path}.lock`,
    signal = options.signal;
  const issues: Issue[] = [];
  let before: BigIntStats | undefined, fileBefore: BigIntStats | undefined;
  let directoryValidated = false,
    changed = false;
  let lockPresent: boolean | null = null,
    journalPresent: boolean | null = null;
  let artifacts: number | null = null,
    temporaryFiles = 0,
    authenticatedArtifacts = 0;
  let headAuthenticated: boolean | null = null,
    activationEligible: boolean | null = null;
  let head: ReturnType<SnapshotVerifier["verify"]> | undefined;
  let headToken: string | undefined;
  let code: IssueCode = "READ_FAILED";
  try {
    signal?.throwIfAborted();
    before = await lstat(directory, { bigint: true });
    code = "UNSAFE_DIRECTORY";
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (process.getuid !== undefined && before.uid !== BigInt(process.getuid()))
    )
      throw new Error();
    directoryValidated = true;
    code = "READ_FAILED";
    lockPresent = await present(lock);
    if (!lockPresent) {
      let entries = 0;
      for await (const entry of await opendir(directory)) {
        signal?.throwIfAborted();
        code = "ENTRY_LIMIT";
        if (++entries > maxEntries) throw new Error();
        if (entry.name.startsWith(`.${basename(path)}.`) && entry.name.endsWith(".tmp"))
          temporaryFiles++;
      }
      code = "READ_FAILED";
      if (temporaryFiles) issues.push({ code: "TEMPORARY_FILES" });
      journalPresent = await present(path);
      if (journalPresent) {
        fileBefore = await lstat(path, { bigint: true });
        const read = await readDiagnosticText(path, maxBytes, signal);
        if (!sameDiagnosticFile(fileBefore, read.before)) throw new DiagnosticReadError("CHANGED");
        code = "JOURNAL_INVALID";
        const journal = parseSnapshotJournal(read.text);
        artifacts = journal.artifacts.length;
        if (historical) inspect(journal.artifacts, historical);
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof DiagnosticReadError) {
      if (error.code === "CHANGED") changed = true;
      else issues.push({ code: error.code });
    } else issues.push({ code });
  }
  // Check even on failure: an atomic replacement can otherwise resemble corruption.
  if (directoryValidated && before) {
    try {
      signal?.throwIfAborted();
      if (!sameDiagnosticFile(before, await lstat(directory, { bigint: true }))) changed = true;
      if (fileBefore && !sameDiagnosticFile(fileBefore, await lstat(path, { bigint: true })))
        changed = true;
      lockPresent = (await present(lock)) || lockPresent === true;
    } catch {
      signal?.throwIfAborted();
      changed = true;
    }
  }
  signal?.throwIfAborted();
  // Freshness follows all asynchronous filesystem observations and historical work.
  if (!changed && !lockPresent && head && headToken && fresh) {
    if (issues.some((issue) => issue.code === "HISTORY_ORDER_INVALID")) activationEligible = false;
    else {
      try {
        fresh.verify(Buffer.from(headToken, "utf8"), head.provenance);
        activationEligible = true;
      } catch {
        activationEligible = false;
        issues.push({ code: "HEAD_NOT_ACTIVATABLE", artifactIndex: 0 });
      }
    }
  }
  signal?.throwIfAborted();
  const status = lockPresent
    ? "busy"
    : changed
      ? "changed"
      : issues.length
        ? "issues"
        : !journalPresent
          ? "missing"
          : historical
            ? "valid"
            : "structureOnly";
  const inconclusive = status === "busy" || status === "changed";
  return Object.freeze({
    status,
    consistentSnapshot: false,
    rollbackProtected: false,
    lockPresent,
    journalPresent,
    artifacts,
    temporaryFiles,
    headAuthenticated: inconclusive ? null : headAuthenticated,
    activationEligible: inconclusive ? null : activationEligible,
    authenticatedArtifacts: inconclusive ? 0 : authenticatedArtifacts,
    issues: Object.freeze((inconclusive ? [] : issues).map((issue) => Object.freeze(issue)))
  });

  function inspect(tokens: readonly string[], historical: SnapshotVerifier): void {
    let previous: { sequence: number; issuedAt: number } | undefined;
    for (const [index, token] of tokens.entries()) {
      signal?.throwIfAborted();
      let entry: ReturnType<SnapshotVerifier["verify"]>;
      try {
        entry = historical.verify(Buffer.from(token, "utf8"));
      } catch {
        issues.push({
          code: index === 0 ? "HEAD_UNVERIFIABLE" : "HISTORY_UNVERIFIABLE",
          artifactIndex: index
        });
        if (index === 0) {
          headAuthenticated = false;
          activationEligible = false;
          return;
        }
        continue;
      }
      authenticatedArtifacts++;
      if (index === 0) {
        headAuthenticated = true;
        head = entry;
        headToken = token;
      }
      if (
        previous &&
        (entry.provenance.sequence >= previous.sequence ||
          entry.provenance.issuedAt > previous.issuedAt)
      )
        issues.push({ code: "HISTORY_ORDER_INVALID", artifactIndex: index });
      previous = entry.provenance;
    }
  }
}

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
