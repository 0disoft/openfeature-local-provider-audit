import { afterEach, expect, it, vi } from "vitest";
import { createSnapshotInputBudget } from "../../src/flags/snapshot-input-budget.js";
import { captureSnapshotInput } from "../../src/flags/capture-snapshot-input.js";

afterEach(() => vi.restoreAllMocks());
it.each([
  "",
  "ascii",
  '\0\b\t\n\f\r"\\',
  "é",
  "가",
  "😀",
  "\ud800",
  "\udc00",
  "\ud800x",
  "\u2028\u2029"
])("counts JSON-encoded UTF-8 at the exact and one-byte-under boundary: %j", (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  const exact = createSnapshotInputBudget(bytes);
  expect(() => exact.string(value)).not.toThrow();
  expect(() => exact.charge(1)).toThrow(RangeError);
  expect(() => createSnapshotInputBudget(bytes - 1).string(value)).toThrow(RangeError);
});
it("counts every alias occurrence but scans an identical string only once", () => {
  const budget = createSnapshotInputBudget(10);
  const read = vi.spyOn(String.prototype, "charCodeAt");
  budget.string("abc");
  budget.string("abc");
  const calls = read.mock.calls.length;
  read.mockRestore();
  expect(calls).toBe(3);
  expect(() => budget.string("abc")).toThrow(RangeError);
});
it("bounds direct input independently of node limits without materializing a huge JSON string", () => {
  const scalar = "x".repeat(2 * 1024 * 1024);
  expect(captureSnapshotInput(Array(49).fill(scalar))).toHaveLength(49);
  expect(() => captureSnapshotInput(Array(50).fill(scalar))).toThrowError(
    expect.objectContaining({ code: "SCHEMA_ERROR" })
  );
});
