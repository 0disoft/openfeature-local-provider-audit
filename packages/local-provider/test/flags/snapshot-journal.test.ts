import { afterEach, expect, it, vi } from "vitest";
import { boundedSnapshotJournal } from "../../src/sources/snapshot-journal.js";

const serialize = (artifacts: readonly string[]) =>
  `${JSON.stringify({ schemaVersion: 1, artifacts })}\n`;
function previousPolicy(input: readonly string[], maxBytes: number): string {
  const artifacts = [...input];
  while (Buffer.byteLength(serialize(artifacts)) > maxBytes && artifacts.length > 1)
    artifacts.pop();
  const serialized = serialize(artifacts);
  if (Buffer.byteLength(serialized) > maxBytes) throw new RangeError();
  return serialized;
}
afterEach(() => vi.restoreAllMocks());

it.each([
  ["newest", "older", "oldest"],
  ['雪\n"\\', "é", "\ud800", "\u0000"],
  ["same", "same", "same"],
  ["head", "large".repeat(100), "small"]
])("preserves exact journal bytes, duplicate order and prefix retention for %j", (...artifacts) => {
  for (let count = 1; count <= artifacts.length; count++) {
    const boundary = Buffer.byteLength(serialize(artifacts.slice(0, count)));
    for (const maxBytes of [boundary - 1, boundary, boundary + 1]) {
      if (maxBytes < Buffer.byteLength(serialize(artifacts.slice(0, 1)))) {
        expect(() => boundedSnapshotJournal(artifacts, maxBytes)).toThrow(RangeError);
      } else {
        const result = boundedSnapshotJournal(artifacts, maxBytes);
        expect(result).toBe(previousPolicy(artifacts, maxBytes));
        expect(Buffer.byteLength(result)).toBeLessThanOrEqual(maxBytes);
      }
    }
  }
});

it("stops at an oversized older entry and never skips it to retain smaller entries", () => {
  const artifacts = ["head", "large".repeat(100), "small"];
  const limit = Buffer.byteLength(serialize(["head", "small"]));
  expect(JSON.parse(boundedSnapshotJournal(artifacts, limit)).artifacts).toEqual(["head"]);
});

it("bounds serialization work by the retained prefix plus its first oversized entry", () => {
  const artifacts = Array.from({ length: 32 }, (_, index) => `${index}:${"x".repeat(16 * 1024)}`);
  const maxBytes = Buffer.byteLength(serialize(artifacts.slice(0, 1)));
  const stringify = vi.spyOn(JSON, "stringify");
  const result = boundedSnapshotJournal(artifacts, maxBytes);
  expect(stringify).toHaveBeenCalledTimes(2);
  stringify.mockRestore();
  expect(result).toBe(previousPolicy(artifacts, maxBytes));
});
