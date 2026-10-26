import { expect, it } from "vitest";
import { createOverrideHash } from "../../src/audit/audit-event.js";
import { createEnvOverrides } from "../../src/env/env-overrides.js";
import type { FlagSnapshot, FlagType, FlagValue } from "../../src/public-types.js";

const defaults: Record<FlagType, FlagValue> = { boolean: false, string: "", number: 0, object: {} };

function snapshot(types: readonly FlagType[]): FlagSnapshot {
  return {
    schemaVersion: 1,
    flags: Object.fromEntries(
      types.map((type, index) => [
        `flag-${index}`,
        { type, envVar: "SHARED", defaultVariant: "v", variants: { v: defaults[type] } }
      ])
    )
  };
}

it.each([{ value: { nested: [1, 2] } }, { value: [1, { nested: true }] }])(
  "shares frozen identical object overrides only within one creation",
  ({ value }) => {
    const input = snapshot(["object", "object"]);
    const env = { SHARED: JSON.stringify(value) };
    const state = createEnvOverrides(input, { env });
    expect(state.values["flag-0"]).toBe(state.values["flag-1"]);
    expect(state.values["flag-0"]).toEqual(value);
    expect(createOverrideHash(state)).toBe(
      createOverrideHash({
        values: { "flag-0": JSON.parse(env.SHARED), "flag-1": JSON.parse(env.SHARED) },
        errors: {}
      })
    );
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      expect(Object.isFrozen(node)).toBe(true);
      expect(() => Object.defineProperty(node, "changed", { value: true })).toThrow(TypeError);
      for (const child of Object.values(node)) walk(child);
    };
    walk(state.values["flag-0"]);
    expect(Object.isFrozen(env)).toBe(false);
    const next = createEnvOverrides(input, { env });
    expect(next.values["flag-0"]).not.toBe(state.values["flag-0"]);
    env.SHARED = '{"new":true}';
    expect(createEnvOverrides(input, { env }).values["flag-0"]).toEqual({ new: true });
    expect(state.values["flag-0"]).toEqual(value);
  }
);

it("reads each env binding in order and keeps one successful parse across failures", () => {
  const sequence = ['{"version":1}', "{", '{"version":1}', '{"version":2}', '{"version":1}'];
  let reads = 0;
  const env = {
    get SHARED() {
      return sequence[reads++];
    }
  };
  const state = createEnvOverrides(snapshot(Array(5).fill("object")), { env });
  expect(reads).toBe(5);
  expect(Object.keys(state.values)).toEqual(["flag-0", "flag-2", "flag-3", "flag-4"]);
  expect(state.errors["flag-1"]).toBe("Object env override must be valid JSON.");
  expect(state.values["flag-0"]).toBe(state.values["flag-2"]);
  expect(state.values["flag-3"]).toEqual({ version: 2 });
  expect(state.values["flag-4"]).toEqual({ version: 1 });
  // A different successful input evicts the earlier entry; no history accumulates.
  expect(state.values["flag-4"]).not.toBe(state.values["flag-0"]);
});

it("keeps type-specific errors and explicit JSON precedence for shared env inputs", () => {
  const state = createEnvOverrides(snapshot(["object", "string", "number", "boolean", "object"]), {
    env: { SHARED: "[]" }
  });
  expect(state.values["flag-0"]).toBe(state.values["flag-4"]);
  expect(state.values["flag-1"]).toBe("[]");
  expect(Object.keys(state.errors)).toEqual(["flag-2", "flag-3"]);
  const replaced = createEnvOverrides(snapshot(["object", "object"]), {
    env: { SHARED: "[]" },
    overridesJson: '{"flag-1":{"explicit":true}}'
  });
  expect(replaced.values["flag-0"]).toEqual([]);
  expect(replaced.values["flag-1"]).toEqual({ explicit: true });
  const explicit = createEnvOverrides(snapshot(["object", "object"]), {
    env: { SHARED: "{" },
    overridesJson: '{"flag-1":{"explicit":true}}'
  });
  expect(Object.keys(explicit.errors)).toEqual(["flag-0"]);
  expect(explicit.values["flag-1"]).toEqual({ explicit: true });
  expect(Object.isFrozen(explicit.values["flag-1"])).toBe(true);
});
