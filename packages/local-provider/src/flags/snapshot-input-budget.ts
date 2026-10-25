// A separate byte budget bounds large scalars/alias expansion, not only node count.
const SHORT_JSON_ESCAPES = new Set([8, 9, 10, 12, 13]);
const MAX_SNAPSHOT_INPUT_BYTES = 100 * 1024 * 1024;

export function createSnapshotInputBudget(maxBytes = MAX_SNAPSHOT_INPUT_BYTES) {
  let remaining = maxBytes;
  const strings = new Map<string, number>();
  const charge = (bytes: number): void => {
    remaining -= bytes;
    if (remaining < 0) throw new RangeError("Snapshot input exceeds its byte budget.");
  };
  return {
    charge,
    string(value: string): void {
      let bytes = strings.get(value);
      if (bytes === undefined) {
        bytes = encodedStringBytes(value, remaining);
        strings.set(value, bytes);
      }
      charge(bytes);
    }
  };
}

// UTF-8 size of JSON's string encoding, without allocating an escaped string/buffer.
function encodedStringBytes(value: string, limit: number): number {
  let bytes = 2; // Quotes.
  if (bytes > limit) throw new RangeError("Snapshot input exceeds its byte budget.");
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32) bytes += SHORT_JSON_ESCAPES.has(code) ? 2 : 6;
    else if (code === 34 || code === 92) bytes += 2;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 6;
    } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
    if (bytes > limit) throw new RangeError("Snapshot input exceeds its byte budget.");
  }
  return bytes;
}
