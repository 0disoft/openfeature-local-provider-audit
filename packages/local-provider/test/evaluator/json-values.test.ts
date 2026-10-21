import { expect, it } from "vitest";
import { isJsonValue } from "../../src/evaluator/type-guards.js";
import { createLocalProvider } from "../../src/provider/local-provider.js";

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
