import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createOverrideHash, stableStringify } from "../../src/audit/audit-event.js";
import { createEnvOverrides } from "../../src/env/env-overrides.js";
import type { EnvOverrideState, FlagSnapshot } from "../../src/public-types.js";

function captured(overridesJson?: string): EnvOverrideState {
  const names = ["10", "2", "02", "__proto__", 'a"', "Ä", "Z"];
  const snapshot: FlagSnapshot = {
    schemaVersion: 1,
    flags: Object.fromEntries([
      ...names.map((name) => [
        name,
        {
          type: "object",
          variants: { v: {} },
          defaultVariant: "v",
          envVar: "SHARED"
        }
      ]),
      ["broken", { type: "boolean", variants: { v: false }, defaultVariant: "v", envVar: "BAD" }]
    ])
  };
  return createEnvOverrides(snapshot, {
    env: { SHARED: '{"10":null,"2":[true,"☃\\n"],"02":{"z":1,"a":0}}', BAD: "invalid" },
    ...(overridesJson === undefined ? {} : { overridesJson })
  });
}

it.each([undefined, "{", '{"extra":null,"scalar":"value"}'])(
  "preserves canonical hashes with integer keys, escapes, errors and JSON override %s",
  (json) => {
    const state = captured(json);
    const expected = createHash("sha256").update(stableStringify(state)).digest("hex");
    expect(createOverrideHash(state)).toBe(expected);
  }
);

it("hashes a state exceeding a serialization cap when each shared value fits", () => {
  const snapshot: FlagSnapshot = {
    schemaVersion: 1,
    flags: Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [
        String(i),
        {
          type: "object",
          variants: { v: {} },
          defaultVariant: "v",
          envVar: "SHARED"
        }
      ])
    )
  };
  const state = createEnvOverrides(snapshot, {
    env: { SHARED: JSON.stringify({ payload: "x".repeat(4096) }) }
  });
  const expected = createHash("sha256").update(stableStringify(state)).digest("hex");
  const stringify = JSON.stringify.bind(JSON);
  const intercepted = vi.spyOn(JSON, "stringify").mockImplementation((value) => {
    const encoded = stringify(value);
    // Scale V8's maximum-string failure down without allocating hundreds of MiB in CI.
    if (encoded.length > 8192) throw new RangeError("Invalid string length");
    return encoded;
  });
  try {
    expect(() => createOverrideHash({ ...state })).toThrow(RangeError);
    expect(createOverrideHash(state)).toBe(expected);
    const sharedCopies = intercepted.mock.calls.filter(
      ([value]) => value !== null && typeof value === "object" && Object.hasOwn(value, "payload")
    );
    expect(sharedCopies).toHaveLength(1);
  } finally {
    intercepted.mockRestore();
  }
});

it("keeps caller-owned frozen inputs on their original traversal without caching mutable children", () => {
  const value = { nested: 1 };
  const foreign = Object.freeze({ values: { feature: value }, errors: {} });
  const first = createOverrideHash(foreign);
  value.nested = 2;
  expect(createOverrideHash(foreign)).not.toBe(first);
  expect(createOverrideHash(foreign)).toBe(
    createHash("sha256").update(stableStringify(foreign)).digest("hex")
  );
});
