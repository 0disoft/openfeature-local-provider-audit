import { expect, it } from "vitest";
import { createReloadableLocalProvider, type FlagSnapshot } from "../../src/index.js";

const logger = { warn() {}, error() {}, info() {}, debug() {} };
const snapshot = (value: unknown): FlagSnapshot => ({
  schemaVersion: 1,
  flags: { f: { type: "object", defaultVariant: "v", variants: { v: value as never } } }
});

it("rejects hidden methods and schema accessors without invoking them on create or update", async () => {
  let reads = 0;
  const child = { enabled: false };
  const array = [0];
  Object.defineProperty(array, "map", {
    get() {
      reads++;
      return () => Object.freeze([child]);
    }
  });
  const accessor = snapshot([]);
  Object.defineProperty(accessor.flags.f, "variants", {
    get() {
      reads++;
      return { v: [] };
    }
  });
  const provider = createReloadableLocalProvider({ snapshot: snapshot({ enabled: true }) });
  const hash = provider.getStatus().snapshotHash;
  for (const input of [snapshot(array), accessor]) {
    expect(() => createReloadableLocalProvider({ snapshot: input })).toThrow(
      expect.objectContaining({ code: "SCHEMA_ERROR" })
    );
    expect(() => provider.updateSnapshot(input)).toThrow(
      expect.objectContaining({ code: "SCHEMA_ERROR" })
    );
  }
  expect(reads).toBe(0);
  expect(provider.getStatus().snapshotHash).toBe(hash);
  expect((await provider.resolveObjectEvaluation("f", {}, {}, logger)).value).toEqual({
    enabled: true
  });
  await provider.onClose?.();
});

it("copies shared acyclic and shallow-frozen inputs without trusting inherited array methods", async () => {
  let calls = 0;
  const child = { enabled: false };
  const array = [child];
  Object.setPrototypeOf(array, {
    map() {
      calls++;
      return [child];
    }
  });
  const input = snapshot(Object.freeze({ left: array, right: array }));
  const hashes: string[] = [];
  const provider = createReloadableLocalProvider({
    snapshot: input,
    auditSink: {
      async write(event) {
        hashes.push(event.snapshotHash);
      }
    }
  });
  child.enabled = true;
  const first = await provider.resolveObjectEvaluation("f", {}, {}, logger);
  expect(first.value).toEqual({ left: [{ enabled: false }], right: [{ enabled: false }] });
  const captured = first.value as { left: { enabled: boolean }[]; right: unknown[] };
  expect(captured.left).not.toBe(captured.right);
  expect(Object.isFrozen(captured.left[0])).toBe(true);
  provider.updateSnapshot(input);
  child.enabled = false;
  expect((await provider.resolveObjectEvaluation("f", {}, {}, logger)).value).toEqual({
    left: [{ enabled: true }],
    right: [{ enabled: true }]
  });
  expect(hashes[0]).not.toBe(hashes[1]);
  expect(hashes[1]).toBe(provider.getStatus().snapshotHash);
  expect(calls).toBe(0);
  await provider.onClose?.();
});
