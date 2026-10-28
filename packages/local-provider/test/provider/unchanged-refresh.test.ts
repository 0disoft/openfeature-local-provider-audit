import { createHash } from "node:crypto";
import { ProviderEvents } from "@openfeature/server-sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createReloadableLocalProvider } from "../../src/provider/local-provider.js";
import { createSnapshotRefresher } from "../../src/sources/snapshot-refresher.js";
import type { AuditEvent, SignedSnapshotMetadata } from "../../src/public-types.js";
import { staticSnapshot } from "../fixtures.js";

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});
afterEach(() => vi.restoreAllMocks());
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const origin = (snapshotHash: string): SignedSnapshotMetadata => ({
  keyId: "test",
  audience: "test",
  sequence: 1,
  issuedAt: 1,
  expiresAt: 2,
  snapshotHash,
  artifactHash: "a".repeat(64)
});

it("renews unchanged conditional reads without hashing the whole snapshot again", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const tick = vi.spyOn(performance, "now").mockReturnValue(0);
  const provider = createReloadableLocalProvider({
    snapshot: staticSnapshot,
    env: {},
    staleAfterMs: 100
  });
  const source = {
    fetch: vi
      .fn()
      .mockResolvedValueOnce({
        status: "content",
        content: new TextEncoder().encode(JSON.stringify(staticSnapshot)),
        etag: '"stable"'
      })
      .mockResolvedValue({ status: "notModified" })
  };
  const refresher = createSnapshotRefresher({ provider, source });
  const changes = vi.fn();
  expect(provider.events).toBeDefined();
  provider.events?.addHandler(ProviderEvents.ConfigurationChanged, changes);
  await refresher.refresh();
  vi.mocked(createHash).mockClear();
  now.mockReturnValue(1200);
  tick.mockReturnValue(200);
  expect(provider.getStatus().stale).toBe(true);
  for (let i = 0; i < 2; i++)
    await expect(refresher.refresh()).resolves.toMatchObject({ status: "unchanged" });
  expect(createHash).toHaveBeenCalledTimes(0);
  expect(source.fetch.mock.calls[2]?.[0]).toMatchObject({ etag: '"stable"' });
  expect(provider.getStatus()).toMatchObject({
    stale: false,
    successfulRefreshes: 4,
    lastSuccessfulRefreshAt: 1200,
    lastChangedAt: 1000
  });
  expect(changes).not.toHaveBeenCalled();
  refresher.close();
  await provider.onClose?.();
});

it("preserves captured overrides, hashes and frozen values on same-instance updates", async () => {
  const env = { OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false" };
  const events: AuditEvent[] = [];
  const provider = createReloadableLocalProvider({
    snapshot: staticSnapshot,
    env,
    auditSink: {
      async write(event) {
        events.push(event);
      }
    }
  });
  const owned = provider.getSnapshot();
  await provider.resolveBooleanEvaluation("checkout.enabled", true, {}, logger);
  const first = events[0];
  env.OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED = "true";
  vi.mocked(createHash).mockClear();
  provider.updateSnapshot(owned);
  expect(createHash).not.toHaveBeenCalled();
  await expect(
    provider.resolveBooleanEvaluation("checkout.enabled", true, {}, logger)
  ).resolves.toMatchObject({ value: false });
  expect(events[1]?.overrideHash).toBe(first?.overrideHash);
  expect(events[1]?.snapshotHash).toBe(first?.snapshotHash);
  expect(provider.getSnapshot()).toBe(owned);
  expect(() =>
    Object.assign(owned.flags["checkout.config"]?.variants.default as object, { retries: 999 })
  ).toThrow(TypeError);
  await provider.onClose?.();
});

it("validates and hashes a caller-frozen equal-content copy before reusing flag hashes", () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const input = Object.freeze(structuredClone(staticSnapshot));
  vi.mocked(createHash).mockClear();
  provider.updateSnapshot(input);
  expect(createHash).toHaveBeenCalledTimes(1);
  const getter = vi.fn(() => 1);
  const invalid = Object.defineProperty(structuredClone(staticSnapshot), "metadata", {
    enumerable: true,
    get: getter
  });
  expect(() => provider.updateSnapshot(invalid)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(provider.getStatus().lastRefreshFailure).toBe("validation");
});

it("reuses flag hashes only for accepted equal content and still reports later additions/removals", () => {
  const initial = {
    schemaVersion: 1 as const,
    flags: {
      removed: { type: "boolean" as const, variants: { v: false }, defaultVariant: "v" },
      changed: { type: "boolean" as const, variants: { v: false }, defaultVariant: "v" }
    }
  };
  const provider = createReloadableLocalProvider({ snapshot: initial, env: {} });
  const owned = provider.getSnapshot();
  const changes = vi.fn();
  provider.events?.addHandler(ProviderEvents.ConfigurationChanged, changes);
  vi.mocked(createHash).mockClear();
  provider.updateSnapshot(structuredClone(initial));
  expect(createHash).toHaveBeenCalledTimes(1);
  expect(provider.getSnapshot()).toBe(owned);
  expect(provider.getStatus().successfulRefreshes).toBe(2);
  expect(changes).not.toHaveBeenCalled();

  vi.mocked(createHash).mockClear();
  provider.updateSnapshot({
    schemaVersion: 1,
    flags: {
      added: initial.flags.removed,
      changed: { ...initial.flags.changed, variants: { v: true } }
    }
  });
  expect(createHash).toHaveBeenCalledTimes(3);
  expect(changes).toHaveBeenCalledExactlyOnceWith({
    flagsChanged: ["added", "changed", "removed"]
  });
  expect(provider.getSnapshot().flags.changed?.variants.v).toBe(true);
});

it("restores former content using its cached snapshot hash without skipping activation", () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const previous = provider.getSnapshot();
  const hash = provider.getStatus().snapshotHash;
  provider.updateSnapshot({ ...staticSnapshot, metadata: { revision: 2 } });
  vi.mocked(createHash).mockClear();
  provider.updateSnapshot(previous);
  expect(createHash).toHaveBeenCalledTimes(Object.keys(staticSnapshot.flags).length);
  expect(provider.getStatus().snapshotHash).toBe(hash);
  expect(provider.getStatus().successfulRefreshes).toBe(3);
  expect(provider.getSnapshot()).toBe(previous);
});

it("captures new provenance, rejects mismatches atomically and clears unsigned origin", () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const owned = provider.getSnapshot();
  const provenance = origin(provider.getStatus().snapshotHash);
  provider.updateSnapshot(owned, provenance);
  expect(provider.getStatus().provenance).toEqual(provenance);
  (provenance as { sequence: number }).sequence = 99;
  expect(provider.getStatus().provenance?.sequence).toBe(1);
  const before = provider.getStatus();
  expect(() => provider.updateSnapshot(owned, origin("b".repeat(64)))).toThrow(
    "provenance is invalid"
  );
  expect(provider.getStatus()).toMatchObject({
    provenance: before.provenance,
    successfulRefreshes: before.successfulRefreshes,
    failedRefreshes: 1
  });
  provider.updateSnapshot(owned);
  expect(provider.getStatus().provenance).toBeUndefined();
  expect(provider.getStatus().consecutiveRefreshFailures).toBe(0);
});

it("keeps same-instance preparation reserved until commit or cancellation", () => {
  const provider = createReloadableLocalProvider({ snapshot: staticSnapshot, env: {} });
  const owned = provider.getSnapshot();
  const provenance = origin(provider.getStatus().snapshotHash);
  vi.mocked(createHash).mockClear();
  const cancelled = provider.prepareSnapshot?.(owned, provenance);
  expect(provider.getStatus().provenance).toBeUndefined();
  expect(() => provider.updateSnapshot(owned)).toThrow("pending persistence");
  cancelled?.cancel();
  expect(() => cancelled?.commit()).toThrow("no longer active");
  const transaction = provider.prepareSnapshot?.(owned, provenance);
  expect(provider.getStatus().provenance).toBeUndefined();
  transaction?.commit();
  expect(provider.getStatus().provenance).toEqual(provenance);
  expect(provider.getStatus().successfulRefreshes).toBe(2);
  expect(createHash).not.toHaveBeenCalled();
  expect(() => transaction?.commit()).toThrow("no longer active");
});
