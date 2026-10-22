const PREFIX = '{"schemaVersion":1,"artifacts":[';
const SUFFIX = "]}\n";

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
