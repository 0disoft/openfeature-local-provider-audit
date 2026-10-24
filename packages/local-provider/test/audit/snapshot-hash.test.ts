import { describe, expect, it, vi } from "vitest";
import { createSnapshotHash } from "../../src/audit/audit-event.js";
import { explainEvaluation, parseJsonFlagSnapshot } from "../../src/index.js";
import { validateFlagSnapshot } from "../../src/flags/validate-snapshot.js";

const source = () => ({
  schemaVersion: 1 as const,
  flags: {
    enabled: { type: "boolean" as const, variants: { on: true, off: false }, defaultVariant: "on" }
  }
});
const request = { flagKey: "enabled", expectedType: "boolean" as const, defaultValue: false };

describe("snapshot hash ownership", () => {
  it.each([false, true])(
    "canonicalizes a validator-owned snapshot only once (metadata=%s)",
    (metadata) => {
      const raw = { ...source(), ...(metadata ? { metadata: { version: "first" } } : {}) };
      const snapshot = validateFlagSnapshot(raw);
      const expected = createSnapshotHash(raw);
      const entries = vi.spyOn(Object, "entries");
      try {
        for (let index = 0; index < 5; index++) {
          expect(explainEvaluation(snapshot, request).snapshotHash).toBe(expected);
        }
        expect(entries.mock.calls.filter(([value]) => value === snapshot)).toHaveLength(1);
      } finally {
        entries.mockRestore();
      }
    }
  );

  it("does not retain stale hashes for mutable snapshots", () => {
    const snapshot = source();
    const before = createSnapshotHash(snapshot);
    snapshot.flags.enabled.variants.on = false;
    expect(createSnapshotHash(snapshot)).not.toBe(before);
  });

  it("does not mistake a shallow-frozen caller object for validator ownership", () => {
    const snapshot = Object.freeze(source());
    const before = createSnapshotHash(snapshot);
    snapshot.flags.enabled.variants.on = false;
    expect(createSnapshotHash(snapshot)).not.toBe(before);
  });

  it("recomputes caller-owned frozen accessors whose results change", () => {
    let enabled = true;
    const variants = Object.freeze({
      get on() {
        return enabled;
      },
      off: false
    });
    const snapshot = Object.freeze({
      schemaVersion: 1 as const,
      flags: Object.freeze({
        enabled: Object.freeze({ type: "boolean" as const, variants, defaultVariant: "on" })
      })
    });
    const before = createSnapshotHash(snapshot);
    enabled = false;
    expect(createSnapshotHash(snapshot)).not.toBe(before);
  });

  it("keeps independently parsed snapshots and source mutations separate", () => {
    const raw = source();
    const first = parseJsonFlagSnapshot(JSON.stringify(raw));
    const hash = createSnapshotHash(first);
    raw.flags.enabled.variants.on = false;
    const next = parseJsonFlagSnapshot(JSON.stringify(raw));
    expect(createSnapshotHash(first)).toBe(hash);
    expect(createSnapshotHash(next)).not.toBe(hash);
    expect(explainEvaluation(first, request).snapshotHash).toBe(hash);
  });
});
