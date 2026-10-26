import { afterEach, expect, it, vi } from "vitest";
import { isJsonValue } from "../../src/evaluator/type-guards.js";
import { createLocalProvider } from "../../src/provider/local-provider.js";

afterEach(() => vi.restoreAllMocks());
it.each(["extra", "", "01", "1e0", "-0", " 1", "4294967295"])(
  "rejects a non-index key %j replacing an enumerable array slot",
  (key) => {
    const value = Object.assign([0], { [key]: true });
    value.length = 2;
    expect(Object.keys(value)).toHaveLength(2);
    expect(isJsonValue(value)).toBe(false);
    expect(isJsonValue({ value })).toBe(false);
  }
);

it("accepts dense arrays with reordered proxy keys and non-index names on objects", () => {
  const value = new Proxy([0, 1], { ownKeys: () => ["1", "0", "length"] });
  expect(isJsonValue(value)).toBe(true);
  expect(isJsonValue({ "01": 1, "-0": 0, extra: true })).toBe(true);
  expect(isJsonValue([])).toBe(true);
});

it.each(["root", "nested"])(
  "rejects a %s array exceeding the value node budget before key allocation",
  (location) => {
    const array = Array(location === "root" ? 100_000 : 99_999).fill(0);
    const input = location === "root" ? array : { array };
    const ownKeys = Object.keys;
    let materialized = 0;
    vi.spyOn(Object, "keys").mockImplementation((value) => {
      const keys = ownKeys(value);
      if (value === array) materialized += keys.length;
      return keys;
    });
    expect(isJsonValue(input)).toBe(false);
    expect(materialized).toBe(0);
  }
);
it("preserves the exact remaining value-node boundary for arrays", () => {
  expect(isJsonValue(Array(99_999).fill(0))).toBe(true);
  expect(isJsonValue({ array: Array(99_998).fill(0) })).toBe(true);
});

it("rejects cycles/accessors without executing them and accepts shared acyclic values", () => {
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(isJsonValue(cyclic)).toBe(false);
  expect(() =>
    createLocalProvider({
      snapshot: {
        schemaVersion: 1,
        flags: {
          cyclic: { type: "object", defaultVariant: "v", variants: { v: cyclic as never } }
        }
      }
    })
  ).toThrow(expect.objectContaining({ code: "SCHEMA_ERROR" }));
  let reads = 0;
  expect(
    isJsonValue({
      get secret() {
        reads++;
        return 1;
      }
    })
  ).toBe(false);
  expect(reads).toBe(0);
  const shared = { nested: [1, null] };
  expect(isJsonValue({ left: shared, right: shared })).toBe(true);
});
