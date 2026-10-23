import { expect, it } from "vitest";
import { createEnvOverrides, parseJsonFlagSnapshot } from "../../src/index.js";
import { createIndexedEnvOverrides } from "../../src/env/indexed-overrides.js";
import type { FlagSnapshot } from "../../src/public-types.js";

function snapshot() {
  return parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion: 1,
      flags: {
        second: { type: "string", envVar: "SECOND", defaultVariant: "v", variants: { v: "" } },
        first: { type: "number", envVar: "SHARED", defaultVariant: "v", variants: { v: 0 } },
        other: { type: "boolean", envVar: "SHARED", defaultVariant: "v", variants: { v: false } },
        constructor: {
          type: "string",
          envVar: "constructor",
          defaultVariant: "v",
          variants: { v: "" }
        },
        unused: { type: "boolean", defaultVariant: "v", variants: { v: false } }
      }
    })
  );
}
it("preserves shared env names, snapshot order, JSON precedence and errors", () => {
  const target = snapshot(),
    indexed = createIndexedEnvOverrides(target);
  for (const options of [
    { env: { SHARED: "1", SECOND: "copy", constructor: "own" } },
    { env: { SHARED: "bad" }, overridesJson: '{"first":7,"unknown":true}' },
    { env: {}, overridesJson: "not-json" },
    { env: { SHARED: "true" } },
    { env: {}, overridesJson: '{"first":7}', maxOverridesJsonBytes: 1 }
  ]) {
    const expected = createEnvOverrides(target, options),
      actual = indexed(options);
    expect(actual).toEqual(expected);
    expect(Object.keys(actual.values)).toEqual(Object.keys(expected.values));
    expect(Object.keys(actual.errors)).toEqual(Object.keys(expected.errors));
    expect(Object.isFrozen(actual.values)).toBe(true);
  }
});
it("reads only relevant properties with the same inherited and nonenumerable behavior", () => {
  const target = snapshot();
  const env = Object.create({ SHARED: "5" });
  Object.defineProperty(env, "SECOND", { value: "hidden" });
  Object.defineProperty(env, "unusedGetter", {
    get() {
      throw new Error("unused");
    }
  });
  expect(createIndexedEnvOverrides(target)({ env })).toEqual(createEnvOverrides(target, { env }));
});
it("keeps mutable snapshots live instead of retaining a stale binding", () => {
  const target = JSON.parse(JSON.stringify(snapshot())) as FlagSnapshot;
  const indexed = createIndexedEnvOverrides(target);
  expect(indexed({ env: { SECOND: "before" } })).toEqual(
    createEnvOverrides(target, { env: { SECOND: "before" } })
  );
  Object.defineProperty(target.flags.second, "envVar", { value: "CHANGED" });
  expect(indexed({ env: { CHANGED: "after" } }).values.second).toBe("after");
});
it("uses independent snapshot indexes and no previous request's values", () => {
  const target = snapshot(),
    indexed = createIndexedEnvOverrides(target);
  expect(indexed({ env: { SECOND: "one" } }).values.second).toBe("one");
  expect(indexed({ env: { SECOND: "two" } }).values.second).toBe("two");
  expect(indexed({ env: Object.create(null) }).values).toEqual({});
  const changed = JSON.parse(JSON.stringify(target));
  changed.flags.second.envVar = "NEW";
  const next = createIndexedEnvOverrides(parseJsonFlagSnapshot(JSON.stringify(changed)));
  expect(next({ env: { SECOND: "old", NEW: "new" } }).values.second).toBe("new");
});
