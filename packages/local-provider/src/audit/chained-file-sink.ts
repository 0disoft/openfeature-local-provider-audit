import { withAuditCleanup } from "./cleanup.js";
import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AuditEvent,
  AuditChainCheckpoint,
  AuditChainFileCheckpoint,
  ChainedFileAuditSink,
  ChainedFileAuditSinkOptions
} from "../public-types.js";
import { LocalProviderError } from "../errors/local-provider-error.js";
import { createLockOptions, serializeProcessWrite, withFileLock } from "./audit-sink.js";
import {
  chainInteger,
  createAuditChainCheckpoint,
  createChainedAuditEvent,
  verifyAuditChain,
  verifyAuditChainRecord
} from "./audit-chain.js";
import { MAX_CHAIN_BATCH_BYTES, MAX_CHAIN_BATCH_RECORDS } from "./chain-policy.js";
import { captureChainEvent, dataRecord } from "./chain-event.js";
import { createQueuedAuditSink } from "./queued-sink.js";
import { readChainLines } from "./read-chain-lines.js";
import {
  assertOwnedFile,
  missing,
  openChainFile,
  readChainMetadata,
  readChainRange,
  readChainTail,
  writeChainMetadata
} from "./chain-files.js";

interface Segment {
  readonly file: string;
  readonly start: AuditChainCheckpoint;
  readonly head: AuditChainCheckpoint;
  readonly size: number;
}
interface Manifest {
  readonly schemaVersion: 1;
  readonly initial: AuditChainCheckpoint;
  readonly segments: readonly Segment[];
}
const same = (left: AuditChainCheckpoint, right: AuditChainCheckpoint) =>
  left.chainId === right.chainId && left.sequence === right.sequence && left.hash === right.hash;
const head = (state: Manifest) => state.segments[state.segments.length - 1]?.head ?? state.initial;
const name = (previous: AuditChainCheckpoint) => `segment-${previous.sequence + 1}.jsonl`;

export function createChainedFileAuditSink(
  options: ChainedFileAuditSinkOptions
): ChainedFileAuditSink {
  if (options.onError !== undefined && typeof options.onError !== "function")
    throw new TypeError("onError must be a function.");
  const onError = options.onError?.bind(options);
  const directory = resolve(
    typeof options.directory === "string" ? options.directory : fileURLToPath(options.directory)
  );
  const path = join(directory, "manifest.json");
  const initial = verifyAuditChain([], {
    start: options.initialCheckpoint ?? createAuditChainCheckpoint(options.chainId)
  }).head;
  if (initial.chainId !== options.chainId)
    throw new TypeError("Initial checkpoint chain does not match.");
  const untyped = options as unknown as Record<string, unknown>;
  if (
    untyped.lock === false ||
    untyped.staleLockMs !== undefined ||
    untyped.queueOverflowPolicy === "dropNewest"
  )
    throw new TypeError("Chained audit requires locking, no stale takeover and rejected overflow.");
  const batchSize = chainInteger(
    options.batchSize ?? MAX_CHAIN_BATCH_RECORDS,
    1,
    MAX_CHAIN_BATCH_RECORDS
  );
  const maxBatchBytes = chainInteger(
    options.maxBatchBytes ?? 1024 * 1024,
    1,
    MAX_CHAIN_BATCH_BYTES
  );
  const maxRecordBytes = chainInteger(options.maxRecordBytes ?? 1024 * 1024, 1, 16 * 1024 * 1024);
  const maxSegmentBytes = chainInteger(
    options.maxSegmentBytes ?? 10 * 1024 * 1024,
    1,
    100 * 1024 * 1024
  );
  const maxSegments = chainInteger(options.maxSegments ?? 5, 1, 128);
  const maxVerificationBytes = chainInteger(
    options.maxVerificationBytes ?? 256 * 1024 * 1024,
    1,
    1024 * 1024 * 1024
  );
  if (maxSegments * Math.max(maxSegmentBytes, maxRecordBytes + 1) > maxVerificationBytes)
    throw new RangeError("Verification budget must cover retained segments.");
  const configuredLock = createLockOptions(
    {
      path,
      lock: true,
      ...(options.lockTimeoutMs !== undefined ? { lockTimeoutMs: options.lockTimeoutMs } : {})
    },
    path
  );
  if (configuredLock === undefined) throw new Error();
  const lock: NonNullable<typeof configuredLock> = configuredLock;

  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stats = await lstat(directory);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        (process.geteuid !== undefined && stats.uid !== process.geteuid())
      )
        throw new Error();
      let result!: T;
      await serializeProcessWrite(path, () =>
        withFileLock(lock, async () => {
          result = await operation();
        })
      );
      return result;
    } catch (error) {
      try {
        void Promise.resolve(onError?.(error)).catch(() => {});
      } catch {
        // Trusted operator diagnostics must not replace or delay storage failure.
      }
      throw unavailable();
    }
  }
  function checkpoint(value: unknown): AuditChainCheckpoint {
    const result = verifyAuditChain([], { start: value as AuditChainCheckpoint }).head;
    if (result.chainId !== initial.chainId) throw new Error();
    return result;
  }
  async function load(): Promise<Manifest> {
    const raw = await readChainMetadata(path);
    if (raw === undefined) {
      if ((await readdir(directory)).some((file) => file !== "manifest.json.lock"))
        throw new Error();
      const state: Manifest = { schemaVersion: 1, initial, segments: [] };
      await writeChainMetadata(path, state);
      return state;
    }
    const record = dataRecord(raw, ["schemaVersion", "initial", "segments"]);
    if (
      record.schemaVersion !== 1 ||
      !same(checkpoint(record.initial), initial) ||
      !Array.isArray(record.segments) ||
      record.segments.length > 128
    )
      throw new Error();
    const segments: Segment[] = [];
    for (const item of record.segments) {
      const segment = dataRecord(item, ["file", "start", "head", "size"]);
      const start = checkpoint(segment.start),
        end = checkpoint(segment.head);
      if (
        segment.file !== name(start) ||
        end.sequence <= start.sequence ||
        start.sequence < initial.sequence ||
        (segments.length > 0 && !same(start, segments[segments.length - 1]?.head ?? initial)) ||
        (start.sequence === initial.sequence && !same(start, initial))
      )
        throw new Error();
      segments.push({
        file: segment.file as string,
        start,
        head: end,
        size: chainInteger(segment.size as number, 1, 116 * 1024 * 1024)
      });
    }
    return { schemaVersion: 1, initial, segments };
  }
  async function commitSegments(state: Manifest, segments: readonly Segment[]): Promise<Manifest> {
    const next: Manifest = { ...state, segments: segments.slice(-maxSegments) };
    await writeChainMetadata(path, next);
    await pruneSegments(next);
    return next;
  }
  async function pruneSegments(state: Manifest): Promise<void> {
    const prefix = state.segments[0]?.start.sequence;
    if (prefix === undefined || prefix === state.initial.sequence) return;
    // The committed retained prefix survives crashes and failed unlink calls.
    // Only this chain's canonical, already-pruned segment namespace is eligible.
    for (const file of await readdir(directory)) {
      const match = /^segment-([1-9][0-9]*)\.jsonl$/.exec(file);
      if (match === null) continue;
      const sequence = Number(match[1]);
      if (
        !Number.isSafeInteger(sequence) ||
        sequence <= state.initial.sequence ||
        sequence > prefix
      )
        continue;
      const target = join(directory, file);
      try {
        assertOwnedFile(await lstat(target));
        await unlink(target);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  }
  function parseLine(bytes: Buffer, previous: AuditChainCheckpoint): AuditChainCheckpoint {
    if (
      bytes.length < 2 ||
      bytes.length > maxRecordBytes + 1 ||
      bytes[bytes.length - 1] !== 10 ||
      bytes.subarray(0, -1).includes(10)
    )
      throw new Error();
    return verifyAuditChainRecord(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, -1))),
      previous,
      { maxRecordBytes }
    );
  }
  function parseSuffix(bytes: Buffer, previous: AuditChainCheckpoint): AuditChainCheckpoint {
    let current = previous;
    let offset = 0;
    let records = 0;
    if (bytes.length === 0) throw new Error();
    while (offset < bytes.length) {
      if (
        ++records > MAX_CHAIN_BATCH_RECORDS ||
        (records > 1 && bytes.length > MAX_CHAIN_BATCH_BYTES)
      )
        throw new Error();
      const end = bytes.indexOf(10, offset);
      if (end < 0) throw new Error();
      current = parseLine(bytes.subarray(offset, end + 1), current);
      offset = end + 1;
    }
    return current;
  }
  async function recover(state: Manifest): Promise<Manifest> {
    for (let index = 0; index < state.segments.length; index++) {
      const segment = state.segments[index];
      if (segment === undefined) throw new Error();
      const handle = await openChainFile(join(directory, segment.file));
      await withAuditCleanup(
        async () => {
          const size = (await handle.stat()).size;
          if (size < segment.size || (index < state.segments.length - 1 && size !== segment.size))
            throw new Error();
          if (index === state.segments.length - 1) {
            const last = await readChainTail(handle, segment.size, maxRecordBytes);
            const raw = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(last.subarray(0, -1))
            ) as { previousHash: string };
            const checked = parseLine(last, {
              schemaVersion: 1,
              chainId: initial.chainId,
              sequence: segment.head.sequence - 1,
              hash: raw.previousHash
            });
            if (!same(checked, segment.head)) throw new Error();
            if (size > segment.size) {
              if (size - segment.size > Math.max(MAX_CHAIN_BATCH_BYTES, maxRecordBytes + 1))
                throw new Error();
              const accepted = parseSuffix(
                await readChainRange(handle, segment.size, size - segment.size),
                segment.head
              );
              await handle.sync();
              state = await commitSegments(state, [
                ...state.segments.slice(0, -1),
                { ...segment, head: accepted, size }
              ]);
            }
          }
        },
        () => handle.close(),
        "Audit recovery and segment close failed."
      );
    }
    if (head(state).sequence < Number.MAX_SAFE_INTEGER) {
      const file = name(head(state));
      let handle: Awaited<ReturnType<typeof openChainFile>> | undefined;
      try {
        handle = await openChainFile(join(directory, file));
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (handle !== undefined) {
        const orphan = handle;
        await withAuditCleanup(
          async () => {
            const size = (await handle.stat()).size;
            if (size > Math.max(MAX_CHAIN_BATCH_BYTES, maxRecordBytes + 1)) throw new Error();
            const accepted = parseSuffix(await readChainRange(handle, 0, size), head(state));
            await handle.sync();
            state = await commitSegments(state, [
              ...state.segments,
              { file, start: head(state), head: accepted, size }
            ]);
          },
          () => orphan.close(),
          "Audit orphan recovery and close failed."
        );
      }
    }
    await pruneSegments(state);
    return state;
  }
  async function writeEvents(events: readonly AuditEvent[]): Promise<void> {
    return exclusive(async () => {
      let state = await recover(await load());
      let lines: string[] = [];
      let bytes = 0;
      let end = head(state);
      let baseSize = 0;
      let rotate = false;
      async function persist(): Promise<void> {
        if (lines.length === 0) return;
        const previous = state.segments[state.segments.length - 1];
        const file = rotate ? name(head(state)) : previous?.file;
        if (file === undefined) throw new Error();
        const handle = rotate
          ? await open(join(directory, file), "wx", 0o600)
          : await openChainFile(join(directory, file));
        await withAuditCleanup(
          async () => {
            await handle.appendFile(lines.join(""), "utf8");
            await handle.sync();
          },
          () => handle.close(),
          "Audit batch append and close failed."
        );
        const segment: Segment = {
          file,
          start: rotate ? head(state) : (previous?.start ?? head(state)),
          head: end,
          size: baseSize + bytes
        };
        // Publish each chunk before touching the next segment: recovery needs at
        // most one bounded suffix or one next-sequence orphan, even across rotation.
        state = await commitSegments(
          state,
          rotate ? [...state.segments, segment] : [...state.segments.slice(0, -1), segment]
        );
        lines = [];
        bytes = 0;
      }
      for (const event of events) {
        const record = createChainedAuditEvent(event, end, { maxRecordBytes });
        const line = `${JSON.stringify(record)}\n`;
        const size = Buffer.byteLength(line);
        if (
          lines.length > 0 &&
          (bytes + size > maxBatchBytes || baseSize + bytes + size > maxSegmentBytes)
        )
          await persist();
        if (lines.length === 0) {
          const previous = state.segments[state.segments.length - 1];
          rotate = previous === undefined || previous.size + size > maxSegmentBytes;
          baseSize = rotate ? 0 : (previous?.size ?? 0);
        }
        lines.push(line);
        bytes += size;
        end = {
          schemaVersion: 1,
          chainId: record.chainId,
          sequence: record.sequence,
          hash: record.hash
        };
      }
      await persist();
    });
  }
  const queued = createQueuedAuditSink(
    {
      path,
      ...(options.maxQueueSize !== undefined ? { maxQueueSize: options.maxQueueSize } : {}),
      ...(options.maxQueueBytes !== undefined ? { maxQueueBytes: options.maxQueueBytes } : {})
    },
    (event) => writeEvents([event]),
    { maxSize: batchSize, maxBytes: maxBatchBytes, write: writeEvents }
  );
  return {
    ...queued,
    async write(event) {
      return queued.write(captureChainEvent(event, maxRecordBytes));
    },
    async writeConfirmed(event) {
      return (
        queued.writeConfirmed?.(captureChainEvent(event, maxRecordBytes)) ??
        Promise.reject(unavailable())
      );
    },
    async getCheckpoint(): Promise<AuditChainFileCheckpoint> {
      await queued.flush?.();
      return exclusive(async () => {
        const state = await recover(await load());
        const start = state.segments[0]?.start ?? initial;
        let current = start;
        const budget = { remaining: maxVerificationBytes };
        for (const segment of state.segments)
          for await (const line of readChainLines(
            join(directory, segment.file),
            budget,
            maxRecordBytes
          ))
            current = verifyAuditChainRecord(JSON.parse(line), current, { maxRecordBytes });
        if (!same(current, head(state))) throw new Error();
        return Object.freeze({
          start,
          head: current,
          files: Object.freeze(state.segments.map((segment) => segment.file))
        });
      });
    }
  };
}
function unavailable(): LocalProviderError {
  return new LocalProviderError("AUDIT_SINK_ERROR", "Chained audit storage is unavailable.");
}
