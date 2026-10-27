import { createHash } from "node:crypto";
import { lstat, mkdir, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BigIntStats } from "node:fs";
import type {
  AuditEvidenceExport,
  AuditEvidenceFile,
  ExportAuditEvidenceOptions
} from "../public-types.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { observeDiagnosticResult } from "../errors/observe-diagnostic.js";
import { chainInteger, verifyAuditChainRecord } from "./audit-chain.js";
import { createLockOptions, serializeProcessWrite, withFileLock } from "./audit-sink.js";
import {
  assertOwnedFile,
  openReadOnlyChainFile,
  readChainMetadata,
  syncChainDirectory,
  writeChainMetadata
} from "./chain-files.js";
import { parseChainManifest, sameCheckpoint, type ChainManifest } from "./chain-manifest.js";
import { withAuditCleanup } from "./cleanup.js";
import { readChainLines } from "./read-chain-lines.js";

const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

export async function exportChainedAuditEvidence(
  options: ExportAuditEvidenceOptions
): Promise<AuditEvidenceExport> {
  if (options.onError !== undefined && typeof options.onError !== "function")
    throw new TypeError("onError must be a function.");
  const onError = options.onError?.bind(options);
  const directory = resolve(
    typeof options.directory === "string" ? options.directory : fileURLToPath(options.directory)
  );
  const destination = resolve(
    typeof options.destination === "string"
      ? options.destination
      : fileURLToPath(options.destination)
  );
  const maxBytes = chainInteger(options.maxBytes ?? 256 * 1024 * 1024, 1, 1024 * 1024 * 1024);
  const maxRecordBytes = chainInteger(options.maxRecordBytes ?? 1024 * 1024, 1, 16 * 1024 * 1024);
  const maxRecords = chainInteger(options.maxRecords ?? 100_000, 0, 10_000_000);
  const manifestPath = join(directory, "manifest.json");
  const lock = createLockOptions(
    {
      path: manifestPath,
      lock: true,
      ...(options.lockTimeoutMs !== undefined ? { lockTimeoutMs: options.lockTimeoutMs } : {})
    },
    manifestPath
  );
  if (lock === undefined) throw new Error("Audit evidence export requires a writer lock.");
  const signal = options.signal;
  const files: AuditEvidenceFile[] = [];
  let sourceBytes = 0;
  try {
    signal?.throwIfAborted();
    const originalDirectory = await assertDirectory(directory);
    // Resolve the existing destination parent so symlink/junction aliases cannot
    // put an export back inside the source. A new, caller-owned parent is required.
    const sourceReal = await realpath(directory);
    const destinationReal = join(await realpath(dirname(destination)), basename(destination));
    if (inside(sourceReal, destinationReal) || inside(destinationReal, sourceReal))
      throw new Error("Audit evidence source and destination must not overlap.");
    let captured!: ChainManifest;
    await serializeProcessWrite(manifestPath, () => {
      signal?.throwIfAborted();
      return withFileLock(lock, async () => {
        signal?.throwIfAborted();
        const currentDirectory = await assertDirectory(directory);
        if (
          currentDirectory.ino !== originalDirectory.ino ||
          currentDirectory.dev !== originalDirectory.dev
        )
          throw new Error("Audit evidence source directory changed.");
        const before = await lstat(manifestPath, { bigint: true });
        assertOwnedFile(before);
        captured = parseChainManifest(await readChainMetadata(manifestPath, true));
        const allowed = new Set([
          "manifest.json",
          "manifest.json.lock",
          ...captured.segments.map((segment) => segment.file)
        ]);
        let entries = 0;
        for await (const entry of await opendir(directory)) {
          signal?.throwIfAborted();
          if (++entries > allowed.size || !allowed.has(entry.name))
            throw new Error("Uncommitted or unexpected audit artifact blocks export.");
        }
        const expectedBytes =
          Number(before.size) + captured.segments.reduce((sum, segment) => sum + segment.size, 0);
        if (expectedBytes > maxBytes) throw new Error("Audit evidence byte limit exceeded.");
        const declaredStart = captured.segments[0]?.start ?? captured.initial;
        const declaredHead = captured.segments.at(-1)?.head ?? captured.initial;
        if (declaredHead.sequence - declaredStart.sequence > maxRecords)
          throw new Error("Audit evidence record limit exceeded.");
        // Never overwrite an existing directory, even when empty. Failed exports
        // may leave a partial new destination, but cannot destroy previous evidence.
        await mkdir(destination, { mode: 0o700 });
        await copy("manifest.json", Number(before.size));
        for (const segment of captured.segments) await copy(segment.file, segment.size);
        if (!sameFile(before, await lstat(manifestPath, { bigint: true })))
          throw new Error("Audit evidence manifest changed during export.");
      });
    });

    // CPU verification and checkpoint publication no longer hold the writer lock.
    const start = captured.segments[0]?.start ?? captured.initial;
    let head = start,
      records = 0;
    const budget = { remaining: maxBytes };
    for (const segment of captured.segments) {
      for await (const line of readChainLines(
        join(destination, segment.file),
        budget,
        maxRecordBytes
      )) {
        signal?.throwIfAborted();
        if (records >= maxRecords) throw new Error("Audit evidence record limit exceeded.");
        head = verifyAuditChainRecord(JSON.parse(line), head, { maxRecordBytes });
        records++;
      }
      if (!sameCheckpoint(head, segment.head))
        throw new Error("Audit evidence segment checkpoint mismatch.");
    }
    await checkpoint("start.json", start);
    await checkpoint("head.json", head);
    const result: AuditEvidenceExport = Object.freeze({
      schemaVersion: 1,
      checkpointAuthenticated: false,
      start,
      head,
      records,
      sourceBytes,
      files: Object.freeze(files)
    });
    signal?.throwIfAborted();
    // Atomic completion marker in the newly created destination only.
    await writeChainMetadata(join(destination, "evidence.json"), result);
    await syncChainDirectory(dirname(destination));
    return result;
  } catch (error) {
    try {
      if (!signal?.aborted || error !== signal.reason) observeDiagnosticResult(onError?.(error));
    } catch {
      /* Operator diagnostics cannot replace storage failure. */
    }
    signal?.throwIfAborted();
    throw new LocalProviderError(
      "AUDIT_SINK_ERROR",
      "Audit evidence export failed; incomplete output may remain."
    );
  }

  async function copy(name: string, expectedBytes: number): Promise<void> {
    signal?.throwIfAborted();
    const sourcePath = join(directory, name);
    const source = await openReadOnlyChainFile(sourcePath);
    await withAuditCleanup(
      async () => {
        const before = await source.stat({ bigint: true });
        if (before.size !== BigInt(expectedBytes) || expectedBytes > maxBytes - sourceBytes)
          throw new Error("Audit evidence source size mismatch or byte limit exceeded.");
        const output = await open(join(destination, name), "wx", 0o600);
        await withAuditCleanup(
          async () => {
            const digest = createHash("sha256");
            const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, expectedBytes)));
            let copied = 0;
            while (copied < expectedBytes) {
              signal?.throwIfAborted();
              const { bytesRead } = await source.read(
                buffer,
                0,
                Math.min(buffer.length, expectedBytes - copied),
                copied
              );
              if (bytesRead === 0)
                throw new Error("Audit evidence source was truncated while copying.");
              signal?.throwIfAborted();
              const chunk = buffer.subarray(0, bytesRead);
              await output.writeFile(chunk);
              digest.update(chunk);
              copied += bytesRead;
            }
            const after = await source.stat({ bigint: true });
            assertOwnedFile(after);
            if (
              !sameFile(before, after) ||
              !sameFile(before, await lstat(sourcePath, { bigint: true }))
            )
              throw new Error("Audit evidence source changed during copying.");
            await output.sync();
            files.push(Object.freeze({ name, bytes: copied, sha256: digest.digest("hex") }));
            sourceBytes += copied;
          },
          () => output.close(),
          "Audit evidence copy and destination close failed."
        );
      },
      () => source.close(),
      "Audit evidence copy and source close failed."
    );
  }

  async function checkpoint(name: string, value: unknown): Promise<void> {
    signal?.throwIfAborted();
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    if (bytes.length > 16 * 1024) throw new Error("Audit evidence checkpoint is too large.");
    const handle = await open(join(destination, name), "wx", 0o600);
    await withAuditCleanup(
      async () => {
        await handle.writeFile(bytes);
        await handle.sync();
      },
      () => handle.close(),
      "Audit evidence checkpoint and close failed."
    );
    files.push(
      Object.freeze({
        name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex")
      })
    );
  }
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
async function assertDirectory(path: string): Promise<BigIntStats> {
  const stat = await lstat(path, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.geteuid !== undefined && stat.uid !== BigInt(process.geteuid()))
  )
    throw new Error("Audit evidence source must be an owned regular directory.");
  return stat;
}
