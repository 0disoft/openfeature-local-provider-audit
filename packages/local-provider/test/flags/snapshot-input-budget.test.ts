import { afterEach, expect, it, vi } from "vitest";
import { createSnapshotInputBudget } from "../../src/flags/snapshot-input-budget.js";
import { captureSnapshotInput } from "../../src/flags/capture-snapshot-input.js";

afterEach(() => vi.restoreAllMocks());
it.each(["root", "nested"])(
  "rejects a %s array beyond the remaining node budget before key allocation",
  (location) => {
    const array = Array(location === "root" ? 100_000 : 99_999).fill(0);
    const input = location === "root" ? array : { array };
    const ownKeys = Reflect.ownKeys;
    let materialized = 0;
    vi.spyOn(Reflect, "ownKeys").mockImplementation((value) => {
      const keys = ownKeys(value);
      if (value === array) materialized += keys.length;
      return keys;
    });
    expect(() => captureSnapshotInput(input)).toThrowError(
      expect.objectContaining({ code: "SCHEMA_ERROR" })
    );
    expect(materialized).toBe(0);
  }
);
it("preserves arrays exactly filling the remaining node budget", () => {
  const array = Array(99_999).fill(0);
  const captured = captureSnapshotInput(array);
  expect(captured).toHaveLength(99_999);
  expect(captured).not.toBe(array);
  const nested = captureSnapshotInput({ array: Array(99_998).fill(0) }) as { array: unknown[] };
  expect(nested.array).toHaveLength(99_998);
});

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
