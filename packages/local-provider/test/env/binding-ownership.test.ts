import { expect, it, vi } from "vitest";
import { createEnvOverrides, evaluateFlag, parseJsonFlagSnapshot } from "../../src/index.js";
import { createSnapshotHash } from "../../src/audit/audit-event.js";
import { createIndexedEnvOverrides } from "../../src/env/indexed-overrides.js";
import type { FlagSnapshot } from "../../src/public-types.js";

type Route = "direct" | "indexed" | "fallback";
function snapshot(envVar?: string, schemaVersion = 1) {
  return parseJsonFlagSnapshot(
    JSON.stringify({
      schemaVersion,
      flags: {
        feature: {
          type: "boolean",
          variants: { on: true, off: false },
          defaultVariant: "off",
          ...(envVar === undefined ? {} : { envVar })
        }
      }
    })
  );
}
function reader(route: Route, input: FlagSnapshot) {
  const target = route === "fallback" ? (JSON.parse(JSON.stringify(input)) as FlagSnapshot) : input;
  if (route === "direct")
    return (env: Record<string, string>) => createEnvOverrides(target, { env });
  const indexed = createIndexedEnvOverrides(target);
  return (env: Record<string, string>) => indexed({ env });
}
function inherited<T>(descriptor: PropertyDescriptor, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "envVar");
  try {
    Object.defineProperty(Object.prototype, "envVar", { configurable: true, ...descriptor });
    return run();
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "envVar", previous);
    else Reflect.deleteProperty(Object.prototype, "envVar");
  }
}
it.each(["direct", "indexed", "fallback"] as const)(
  "%s ignores undeclared inherited env bindings",
  (route) => {
    const input = snapshot();
    const read = reader(route, input);
    const env = { OF_UNDECLARED: "true" };
    const hash = createSnapshotHash(input);
    const overrides = inherited({ value: "OF_UNDECLARED" }, () => read(env));
    expect(overrides.values).toEqual({});
    expect(overrides.errors).toEqual({});
    expect(
      evaluateFlag(input, {
        flagKey: "feature",
        expectedType: "boolean",
        defaultValue: false,
        overrides
      })
    ).toMatchObject({ value: false, reason: "STATIC" });
    expect(createSnapshotHash(input)).toBe(hash);
  }
);
it.each(["direct", "indexed", "fallback"] as const)(
  "%s never invokes an inherited envVar getter",
  (route) => {
    const read = reader(route, snapshot());
    const getter = vi.fn(() => {
      throw new Error("inherited binding getter");
    });
    const overrides = inherited({ get: getter }, () => read({ OF_UNDECLARED: "true" }));
    expect(getter).not.toHaveBeenCalled();
    expect(overrides.values).toEqual({});
  }
);
it.each(["direct", "indexed", "fallback"] as const)(
  "%s preserves declared bindings and inherited nonenumerable environment values",
  (route) => {
    const read = reader(route, snapshot("OF_DECLARED", 2));
    const prototype = Object.defineProperty({}, "OF_DECLARED", { value: "true" });
    const env = Object.create(prototype) as Record<string, string>;
    const getter = vi.fn(() => {
      throw new Error("ignored inherited binding getter");
    });
    const overrides = inherited({ get: getter }, () => read(env));
    expect(getter).not.toHaveBeenCalled();
    expect(overrides.values.feature).toBe(true);
  }
);
