const PREFIX = '{"schemaVersion":1,"artifacts":[';
const SUFFIX = "]}\n";

export interface SnapshotJournal {
  readonly schemaVersion: 1;
  readonly artifacts: readonly string[];
}

export function parseSnapshotJournal(text: string): SnapshotJournal {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid snapshot recovery journal.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record.schemaVersion !== 1 ||
    !Array.isArray(record.artifacts) ||
    record.artifacts.length < 1 ||
    record.artifacts.length > 32 ||
    !record.artifacts.every((artifact) => typeof artifact === "string" && artifact.length > 0)
  )
    throw new TypeError("Invalid snapshot recovery journal.");
  return record as unknown as SnapshotJournal;
}

// Retain the newest contiguous prefix; never skip a large older entry to fill gaps.
export function boundedSnapshotJournal(artifacts: readonly string[], maxBytes: number): string {
  const parts: string[] = [];
  let size = PREFIX.length + SUFFIX.length;
  for (const artifact of artifacts) {
    const encoded = JSON.stringify(artifact);
    const nextSize = size + Buffer.byteLength(encoded, "utf8") + (parts.length > 0 ? 1 : 0);
    if (nextSize > maxBytes) break;
    parts.push(encoded);
    size = nextSize;
  }
  if (parts.length === 0) throw new RangeError("Snapshot journal exceeds maxBytes.");
  return `${PREFIX}${parts.join(",")}${SUFFIX}`;
}
