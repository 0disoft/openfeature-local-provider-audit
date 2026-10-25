import { createHash } from "node:crypto";
import type {
  AuditChainCheckpoint,
  AuditChainOptions,
  AuditChainVerification,
  AuditEvent,
  ChainedAuditEvent,
  VerifyAuditChainOptions
} from "../public-types.js";
import { stableStringify } from "./audit-event.js";
import { captureChainEvent, dataRecord, invalidChain, isHash, isSequence } from "./chain-event.js";

// Inserting a SHA-256 hex hash member adds this many unescaped ASCII bytes.
const HASH_FIELD_BYTES = ',"hash":""'.length + 64;

export function createAuditChainCheckpoint(chainId: string): AuditChainCheckpoint {
  if (typeof chainId !== "string" || !/^[A-Za-z0-9._:/-]{1,128}$/.test(chainId))
    throw invalidChain();
  return Object.freeze({
    schemaVersion: 1,
    chainId,
    sequence: 0,
    hash: digest(`openfeature-local-audit-genesis/v1\0${chainId}`)
  });
}

export function createChainedAuditEvent(
  event: AuditEvent,
  previous: AuditChainCheckpoint,
  options: AuditChainOptions = {}
): ChainedAuditEvent {
  try {
    const limit = recordLimit(options);
    const start = captureCheckpoint(previous);
    if (start.sequence === Number.MAX_SAFE_INTEGER) throw invalidChain();
    const body = {
      schemaVersion: 1 as const,
      chainId: start.chainId,
      sequence: start.sequence + 1,
      previousHash: start.hash,
      event: captureChainEvent(event, limit)
    };
    const canonicalBody = stableStringify(body);
    const record = Object.freeze({
      ...body,
      hash: digest(`openfeature-local-audit-record/v1\0${canonicalBody}`)
    });
    assertSize(canonicalBody, limit);
    return record;
  } catch {
    throw invalidChain();
  }
}

export function verifyAuditChainRecord(
  input: unknown,
  previous: AuditChainCheckpoint,
  options: AuditChainOptions = {}
): AuditChainCheckpoint {
  try {
    const limit = recordLimit(options);
    const start = captureCheckpoint(previous);
    const record = dataRecord(input, [
      "schemaVersion",
      "chainId",
      "sequence",
      "previousHash",
      "event",
      "hash"
    ]);
    if (
      record.schemaVersion !== 1 ||
      record.chainId !== start.chainId ||
      !isSequence(record.sequence) ||
      record.sequence !== start.sequence + 1 ||
      record.previousHash !== start.hash ||
      !isHash(record.hash)
    )
      throw invalidChain();
    record.event = captureChainEvent(record.event, limit);
    const body = {
      schemaVersion: 1,
      chainId: record.chainId,
      sequence: record.sequence,
      previousHash: record.previousHash,
      event: record.event
    };
    const canonicalBody = stableStringify(body);
    assertSize(canonicalBody, limit);
    if (record.hash !== digest(`openfeature-local-audit-record/v1\0${canonicalBody}`))
      throw invalidChain();
    return Object.freeze({
      schemaVersion: 1,
      chainId: start.chainId,
      sequence: record.sequence,
      hash: record.hash
    });
  } catch {
    throw invalidChain();
  }
}

export function verifyAuditChain(
  records: Iterable<unknown>,
  options: VerifyAuditChainOptions
): AuditChainVerification {
  try {
    const limit = recordLimit(options);
    const maxRecords = chainInteger(options.maxRecords ?? 100_000, 0, 10_000_000);
    let head = captureCheckpoint(options.start);
    const expected =
      options.expectedHead === undefined ? undefined : captureCheckpoint(options.expectedHead);
    let count = 0;
    for (const record of records) {
      if (count >= maxRecords) throw invalidChain();
      head = verifyAuditChainRecord(record, head, { maxRecordBytes: limit });
      count++;
    }
    if (
      expected !== undefined &&
      (head.chainId !== expected.chainId ||
        head.sequence !== expected.sequence ||
        head.hash !== expected.hash)
    )
      throw invalidChain();
    return Object.freeze({ records: count, head, checkpointMatched: expected !== undefined });
  } catch {
    throw invalidChain();
  }
}

function captureCheckpoint(value: unknown): AuditChainCheckpoint {
  const checkpoint = dataRecord(value, ["schemaVersion", "chainId", "sequence", "hash"]);
  if (
    checkpoint.schemaVersion !== 1 ||
    !isSequence(checkpoint.sequence) ||
    !isHash(checkpoint.hash)
  )
    throw invalidChain();
  const genesis = createAuditChainCheckpoint(checkpoint.chainId as string);
  if (checkpoint.sequence === 0 && checkpoint.hash !== genesis.hash) throw invalidChain();
  return Object.freeze({
    schemaVersion: 1,
    chainId: genesis.chainId,
    sequence: checkpoint.sequence,
    hash: checkpoint.hash
  });
}
export function chainInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw invalidChain();
  return value;
}
function recordLimit(options: AuditChainOptions): number {
  return chainInteger(options.maxRecordBytes ?? 1024 * 1024, 1, 16 * 1024 * 1024);
}
function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function assertSize(canonicalBody: string, limit: number): void {
  if (Buffer.byteLength(canonicalBody, "utf8") + HASH_FIELD_BYTES > limit) throw invalidChain();
}
