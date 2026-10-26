import { afterEach, expect, it, vi } from "vitest";
import { isJsonValue } from "../../src/evaluator/type-guards.js";
import { createLocalProvider } from "../../src/provider/local-provider.js";

afterEach(() => vi.restoreAllMocks());
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
