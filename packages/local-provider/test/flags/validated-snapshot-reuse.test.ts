import { expect, it, vi } from "vitest";
import { createReloadableLocalProvider } from "../../src/provider/local-provider.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";

function input(schemaVersion: 1 | 2) {
  return {
    schemaVersion,
    flags: {
      feature: { type: "object", defaultVariant: "v", variants: { v: { enabled: true } } }
    }
  };
}

it.each([1, 2] as const)(
  "reuses validator-owned v%s snapshots without recapturing data",
  (version) => {
    const owned = validateFlagSnapshot(input(version));
    const enumerate = vi.spyOn(Reflect, "ownKeys");
    let result: typeof owned | undefined;
    let calls = 0;
    try {
      result = validateFlagSnapshot(owned);
      calls = enumerate.mock.calls.length;
    } finally {
      enumerate.mockRestore();
    }
    expect(result).toBe(owned);
    expect(calls).toBe(0);
  }
);

it.each([1, 2] as const)("still captures an unregistered deeply frozen v%s snapshot", (version) => {
  const owned = validateFlagSnapshot(input(version));
  const unregistered = Object.freeze({ ...owned });
  const result = validateFlagSnapshot(unregistered);
  expect(result).toEqual(owned);
  expect(result).not.toBe(unregistered);
  expect(result.flags).not.toBe(unregistered.flags);
});

it.each([1, 2] as const)("isolates mutable descendants below a frozen v%s input", (version) => {
  const raw = input(version);
  Object.freeze(raw);
  Object.freeze(raw.flags);
  const first = validateFlagSnapshot(raw);
  raw.flags.feature.variants.v.enabled = false;
  const second = validateFlagSnapshot(raw);
  expect(first.flags.feature?.variants.v).toEqual({ enabled: true });
  expect(second.flags.feature?.variants.v).toEqual({ enabled: false });
  expect(Object.isFrozen(first.flags.feature?.variants.v)).toBe(true);
});

it("still rejects frozen caller accessors without executing them", () => {
  const getter = vi.fn(() => ({}));
  const raw = Object.freeze({
    schemaVersion: 1,
    get flags() {
      return getter();
    }
  });
  expect(() => validateFlagSnapshot(raw)).toThrow(
    expect.objectContaining({ code: "SCHEMA_ERROR" })
  );
  expect(getter).not.toHaveBeenCalled();
});

it("keeps provider hashes and decisions when reusing an accepted snapshot", async () => {
  const snapshot = validateFlagSnapshot(input(2));
  const provider = createReloadableLocalProvider({ snapshot, env: {} });
  const hash = provider.getStatus().snapshotHash;
  try {
    provider.updateSnapshot(snapshot);
    expect(provider.getSnapshot()).toBe(snapshot);
    expect(provider.getStatus().snapshotHash).toBe(hash);
    expect(
      evaluateFlag(provider.getSnapshot(), {
        flagKey: "feature",
        expectedType: "object",
        defaultValue: {}
      })
    ).toMatchObject({ value: { enabled: true }, reason: "STATIC", variant: "v" });
  } finally {
    await provider.onClose?.();
  }
});
