import type { AuditChainCheckpoint } from "../public-types.js";
import { chainInteger, verifyAuditChain } from "./audit-chain.js";
import { dataRecord } from "./chain-event.js";

export interface ChainSegment {
  readonly file: string;
  readonly start: AuditChainCheckpoint;
  readonly head: AuditChainCheckpoint;
  readonly size: number;
}
export interface ChainManifest {
  readonly schemaVersion: 1;
  readonly initial: AuditChainCheckpoint;
  readonly segments: readonly ChainSegment[];
}
export const sameCheckpoint = (left: AuditChainCheckpoint, right: AuditChainCheckpoint) =>
  left.chainId === right.chainId && left.sequence === right.sequence && left.hash === right.hash;

// Parsing never initializes, repairs or prunes storage. Both writer and inspector
// use the same path/sequence/size rules; a parsed manifest is not a trusted anchor.
export function parseChainManifest(
  raw: unknown,
  expectedInitial?: AuditChainCheckpoint
): ChainManifest {
  const record = dataRecord(raw, ["schemaVersion", "initial", "segments"]);
  const initial = verifyAuditChain([], { start: record.initial as AuditChainCheckpoint }).head;
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.segments) ||
    record.segments.length > 128 ||
    (expectedInitial !== undefined && !sameCheckpoint(initial, expectedInitial))
  )
    throw new Error();
  const checkpoint = (value: unknown) => {
    const result = verifyAuditChain([], { start: value as AuditChainCheckpoint }).head;
    if (result.chainId !== initial.chainId) throw new Error();
    return result;
  };
  const segments: ChainSegment[] = [];
  for (const item of record.segments) {
    const segment = dataRecord(item, ["file", "start", "head", "size"]);
    const start = checkpoint(segment.start),
      end = checkpoint(segment.head);
    if (
      segment.file !== `segment-${start.sequence + 1}.jsonl` ||
      end.sequence <= start.sequence ||
      start.sequence < initial.sequence ||
      (segments.length > 0 &&
        !sameCheckpoint(start, segments[segments.length - 1]?.head ?? initial)) ||
      (start.sequence === initial.sequence && !sameCheckpoint(start, initial))
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
