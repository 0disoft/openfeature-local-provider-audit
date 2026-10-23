import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProviderEvents } from "@openfeature/server-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileSnapshotStore,
  createReloadableLocalProvider,
  createSnapshotRefresher,
  createSnapshotVerifier,
  signFlagSnapshot,
  LocalProviderError,
  type AuditEvent,
  type FlagSnapshot,
  type SignedSnapshotStore,
  type SnapshotSource,
  type SnapshotRecovery
} from "../../src/index.js";

const NOW = Date.now();
const keys = generateKeyPairSync("ed25519");
const verification = { audience: "durable/test", trustedKeys: { release: keys.publicKey } };
const logger = { debug() {}, info() {}, warn() {}, error() {} };
let directory: string;
let store: SignedSnapshotStore;
function snapshot(enabled = true): FlagSnapshot {
  return {
    schemaVersion: 1,
    flags: {
      feature: {
        type: "boolean",
        variants: { on: true, off: false },
        defaultVariant: enabled ? "on" : "off"
      }
    }
  };
}
function token(sequence = 1, enabled = true, expiresAt = NOW + 60_000) {
  return Buffer.from(
    signFlagSnapshot({
      snapshot: snapshot(enabled),
      privateKey: keys.privateKey,
      keyId: "release",
      audience: verification.audience,
      sequence,
      issuedAt: NOW - 1000,
      expiresAt
    })
  );
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function provider() {
  return createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
}
function source(content = token()): SnapshotSource {
  return {
    async fetch() {
      return { status: "content", content, etag: '"candidate"' };
    }
  };
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "of-durable-"));
  store = createFileSnapshotStore({ path: join(directory, "state.json"), verification });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-durable-"))).toBe(true);
  await rm(directory, { recursive: true, force: true });
});

describe("durable signed refresh", () => {
  it.each(["etag", "status"] as const)(
    "captures response %s before awaiting persistence",
    async (field) => {
      const target = provider();
      const started = deferred<void>();
      const finish = deferred<void>();
      const response = { status: "content" as const, content: token(), etag: '"one"' };
      const commit = vi.fn<SignedSnapshotStore["commit"]>(async (bytes) => {
        started.resolve();
        await finish.promise;
        return store.commit(bytes);
      });
      const fetch = vi
        .fn<SnapshotSource["fetch"]>()
        .mockResolvedValueOnce(response)
        .mockImplementation(async (request) =>
          request?.etag === '"two"'
            ? { status: "notModified" }
            : { status: "content", content: token(2, false), etag: '"two"' }
        );
      const refresher = createSnapshotRefresher({
        provider: target,
        source: { fetch },
        verifier: createSnapshotVerifier(verification),
        store: { load: () => store.load(), commit }
      });
      try {
        const running = refresher.refresh();
        await started.promise;
        Object.assign(response, field === "etag" ? { etag: '"two"' } : { status: "notModified" });
        finish.resolve();
        await running;
        await refresher.refresh();
        expect(fetch.mock.calls[1]?.[0]?.etag).toBe('"one"');
        expect(target.getSnapshot()).toEqual(snapshot(false));
        expect(refresher.getProvenance()?.sequence).toBe(2);
      } finally {
        finish.resolve();
        refresher.close();
      }
    }
  );

  it("captures response metadata before synchronous configuration callbacks", async () => {
    const target = provider();
    const response = {
      status: "content" as const,
      content: Buffer.from(JSON.stringify(snapshot())),
      etag: '"one"'
    };
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce(response)
      .mockResolvedValue({ status: "notModified" });
    target.events?.addHandler(ProviderEvents.ConfigurationChanged, () => {
      response.etag = '"two"';
    });
    const refresher = createSnapshotRefresher({ provider: target, source: { fetch } });
    try {
      await refresher.refresh();
      await refresher.refresh();
      expect(fetch.mock.calls[1]?.[0]?.etag).toBe('"one"');
      expect(target.getSnapshot()).toEqual(snapshot());
    } finally {
      refresher.close();
    }
  });

  it.each([
    ["unquoted", "unquoted"],
    ["line break", '"line\r\nbreak"'],
    ["over limit", `"${"x".repeat(1023)}"`]
  ])("discards malformed custom-source ETags: %s", async (_label, etag) => {
    const target = provider();
    const fetch = vi.fn<SnapshotSource["fetch"]>().mockResolvedValue({
      status: "content",
      content: Buffer.from(JSON.stringify(snapshot())),
      etag
    });
    const refresher = createSnapshotRefresher({ provider: target, source: { fetch } });
    try {
      await refresher.refresh();
      await refresher.refresh();
      expect(fetch.mock.calls[1]?.[0]?.etag).toBeUndefined();
      expect(target.getSnapshot()).toEqual(snapshot());
    } finally {
      refresher.close();
    }
  });

  it.each(['""', 'W/"weak"', `"${"x".repeat(1022)}"`])(
    "retains valid custom-source ETags (case %#)",
    async (etag) => {
      const target = provider();
      const fetch = vi.fn<SnapshotSource["fetch"]>().mockResolvedValue({
        status: "content",
        content: Buffer.from(JSON.stringify(snapshot())),
        etag
      });
      const refresher = createSnapshotRefresher({ provider: target, source: { fetch } });
      try {
        await refresher.refresh();
        await refresher.refresh();
        expect(fetch.mock.calls[1]?.[0]?.etag).toBe(etag);
      } finally {
        refresher.close();
      }
    }
  );

  it("keeps evaluations/audit on old origin until persistence and publishes only after durable acceptance", async () => {
    const events: AuditEvent[] = [];
    const target = createReloadableLocalProvider({
      snapshot: snapshot(false),
      env: {},
      auditWriteMode: "blocking",
      auditSink: {
        async write(event) {
          events.push(event);
        }
      }
    });
    const started = deferred<void>(),
      finish = deferred<void>();
    const commit = vi.fn<SignedSnapshotStore["commit"]>(async (bytes) => {
      started.resolve();
      await finish.promise;
      return store.commit(bytes);
    });
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({ status: "content", content: token(), etag: '"one"' })
      .mockResolvedValue({ status: "notModified" });
    const refresher = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store: { load: () => store.load(), commit }
    });
    const status = target.getStatus();
    const callbackChecks: Promise<unknown>[] = [];
    target.events?.addHandler(ProviderEvents.ConfigurationChanged, () => {
      expect(target.getStatus().provenance?.sequence).toBe(1);
      callbackChecks.push(store.load().then((value) => expect(value?.floor.sequence).toBe(1)));
      callbackChecks.push(target.resolveBooleanEvaluation("feature", false, {}, logger));
    });
    const running = refresher.refresh();
    expect(refresher.refresh()).toBe(running);
    await started.promise;
    expect(target.getSnapshot()).toEqual(snapshot(false));
    expect(target.getStatus().successfulRefreshes).toBe(status.successfulRefreshes);
    expect(() => target.updateSnapshot(snapshot())).toThrow("pending persistence");
    expect(() => target.prepareSnapshot?.(snapshot())).toThrow("pending persistence");
    expect((await target.resolveBooleanEvaluation("feature", true, {}, logger)).value).toBe(false);
    expect(events[0]?.provenance).toBeUndefined();
    finish.resolve();
    await running;
    await Promise.all(callbackChecks);
    expect(events[1]?.provenance?.sequence).toBe(1);
    expect(refresher.getProvenance()?.sequence).toBe(1);
    await refresher.refresh();
    expect(fetch.mock.calls[1]?.[0]?.etag).toBe('"one"');
    expect(commit).toHaveBeenCalledTimes(2);
    expect((await store.load())?.history).toHaveLength(1);
    refresher.close();
  });

  it("preserves active state, freshness and validators on persistence failure and releases preparation", async () => {
    const target = provider();
    const before = target.getStatus();
    const commit = vi
      .fn<SignedSnapshotStore["commit"]>()
      .mockRejectedValueOnce(new Error("private storage path"))
      .mockImplementation((bytes) => store.commit(bytes));
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValue({ status: "content", content: token(), etag: '"new"' });
    const refresher = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store: { load: () => store.load(), commit }
    });
    await expect(refresher.refresh()).rejects.toThrow("Snapshot persistence is unavailable.");
    expect(target.getStatus()).toMatchObject({
      snapshotHash: before.snapshotHash,
      successfulRefreshes: 1,
      lastSuccessfulRefreshAt: before.lastSuccessfulRefreshAt,
      failedRefreshes: 1,
      lastRefreshFailure: "persist"
    });
    expect(refresher.getProvenance()).toBeUndefined();
    target.updateSnapshot(snapshot(false));
    await refresher.refresh();
    expect(fetch.mock.calls[1]?.[0]?.etag).toBeUndefined();
    expect(target.getStatus().provenance?.sequence).toBe(1);
    refresher.close();
  });

  it("reloads the authoritative floor after a commit that succeeded before throwing", async () => {
    const target = provider();
    const commit = vi.fn<SignedSnapshotStore["commit"]>(async (bytes) => {
      await store.commit(bytes);
      throw new Error("ambiguous sync result");
    });
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({ status: "content", content: token(2) })
      .mockResolvedValueOnce({ status: "content", content: token(1) });
    const refresher = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store: { load: () => store.load(), commit }
    });
    await expect(refresher.refresh()).rejects.toThrow("persistence");
    expect(target.getSnapshot()).toEqual(snapshot(false));
    expect((await store.load())?.floor.sequence).toBe(2);
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(target.getStatus().lastRefreshFailure).toBe("signature");
    refresher.close();
  });

  it("does not persist rejected preparation", async () => {
    const target = provider();
    target.prepareSnapshot = () => {
      target.reportRefreshFailure("validation");
      throw new LocalProviderError("SCHEMA_ERROR", "Provider rejected snapshot.");
    };
    const commit = vi.fn<SignedSnapshotStore["commit"]>((bytes) => store.commit(bytes));
    const refresher = createSnapshotRefresher({
      provider: target,
      source: source(),
      verifier: createSnapshotVerifier(verification),
      store: { load: () => store.load(), commit }
    });
    await expect(refresher.refresh()).rejects.toThrow("Provider rejected snapshot.");
    expect(commit).not.toHaveBeenCalled();
    expect(await store.load()).toBeUndefined();
    expect(target.getStatus().failedRefreshes).toBe(1);
    refresher.close();
  });

  it.each(["refresher", "provider"])(
    "drains persistence after %s close without activating the accepted snapshot",
    async (which) => {
      const target = provider();
      const started = deferred<void>(),
        finish = deferred<void>();
      const refresher = createSnapshotRefresher({
        provider: target,
        source: source(),
        verifier: createSnapshotVerifier(verification),
        store: {
          load: () => store.load(),
          async commit(bytes) {
            started.resolve();
            await finish.promise;
            return store.commit(bytes);
          }
        }
      });
      const running = refresher.refresh();
      await started.promise;
      if (which === "refresher") refresher.close();
      else await target.onClose?.();
      finish.resolve();
      await expect(running).rejects.toThrow("closed after persistence");
      expect((await store.load())?.floor.sequence).toBe(1);
      expect(target.getSnapshot()).toEqual(snapshot(false));
      expect(target.getStatus().successfulRefreshes).toBe(1);
      target.updateSnapshot(snapshot(false));
      refresher.close();
    }
  );

  it("never begins persistence when closed during fetch", async () => {
    const target = provider(),
      ready = deferred<void>(),
      response = deferred<Awaited<ReturnType<SnapshotSource["fetch"]>>>();
    const commit = vi.fn<SignedSnapshotStore["commit"]>((bytes) => store.commit(bytes));
    const refresher = createSnapshotRefresher({
      provider: target,
      verifier: createSnapshotVerifier(verification),
      store: { load: () => store.load(), commit },
      source: {
        fetch() {
          ready.resolve();
          return response.promise;
        }
      }
    });
    const running = refresher.refresh();
    await ready.promise;
    refresher.close();
    response.resolve({ status: "content", content: token() });
    await expect(running).rejects.toThrow("closed");
    expect(commit).not.toHaveBeenCalled();
    expect(await store.load()).toBeUndefined();
  });

  it("checks freshness again after storage delay without lowering the accepted floor", async () => {
    const target = provider();
    const refresher = createSnapshotRefresher({
      provider: target,
      source: source(token(1, true, NOW + 1000)),
      verifier: createSnapshotVerifier(verification),
      store: {
        load: () => store.load(),
        async commit(bytes) {
          const accepted = await store.commit(bytes);
          vi.mocked(Date.now).mockReturnValue(NOW + 2000);
          return accepted;
        }
      }
    });
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect((await store.load())?.floor.sequence).toBe(1);
    expect((await store.load())?.current).toBeUndefined();
    expect(target.getSnapshot()).toEqual(snapshot(false));
    expect(target.getStatus()).toMatchObject({
      failedRefreshes: 1,
      lastRefreshFailure: "signature",
      successfulRefreshes: 1
    });
    target.updateSnapshot(snapshot(false));
    refresher.close();
  });

  it("retains durable acceptance after a reentrant unsigned replacement and rejects older source content", async () => {
    const target = provider();
    await store.commit(token(1, false));
    let replaced = false;
    target.events?.addHandler(ProviderEvents.ConfigurationChanged, () => {
      if (!replaced) {
        replaced = true;
        target.updateSnapshot(snapshot(false));
      }
    });
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({ status: "content", content: token(2), etag: '"two"' })
      .mockResolvedValueOnce({ status: "content", content: token(1, false) });
    const refresher = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store
    });
    await expect(refresher.refresh()).rejects.toThrow("during application");
    expect((await store.load())?.floor.sequence).toBe(2);
    expect(target.getStatus().provenance).toBeUndefined();
    expect(refresher.getProvenance()).toBeUndefined();
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(fetch.mock.calls[1]?.[0]?.etag).toBeUndefined();
    refresher.close();
  });

  it("rejects inaccessible storage before fetching and detects updates during recovery", async () => {
    const target = provider(),
      fetch = vi.fn<SnapshotSource["fetch"]>();
    const failed = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store: {
        load: async () => {
          throw new Error("private path");
        },
        commit: (bytes) => store.commit(bytes)
      }
    });
    await expect(failed.refresh()).rejects.toThrow("persistence");
    expect(fetch).not.toHaveBeenCalled();
    failed.close();
    const started = deferred<void>(),
      loaded = deferred<SnapshotRecovery | undefined>();
    const changed = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store: {
        load() {
          started.resolve();
          return loaded.promise;
        },
        commit: (bytes) => store.commit(bytes)
      }
    });
    const pending = changed.refresh();
    await started.promise;
    target.updateSnapshot(snapshot());
    loaded.resolve(undefined);
    await expect(pending).rejects.toThrow("during recovery");
    expect(fetch).not.toHaveBeenCalled();
    changed.close();
  });

  it("rejects mismatched acknowledgments and isolates custom-store buffer mutation", async () => {
    const target = provider();
    const wrong = createSnapshotRefresher({
      provider: target,
      source: source(),
      verifier: createSnapshotVerifier(verification),
      store: {
        load: () => store.load(),
        async commit() {
          return createSnapshotVerifier(verification).verify(token(2));
        }
      }
    });
    await expect(wrong.refresh()).rejects.toThrow("persistence");
    target.updateSnapshot(snapshot(false));
    wrong.close();
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({ status: "content", content: token(), etag: '"one"' })
      .mockResolvedValue({ status: "notModified" });
    const safe = createSnapshotRefresher({
      provider: target,
      source: { fetch },
      verifier: createSnapshotVerifier(verification),
      store: {
        load: () => store.load(),
        async commit(bytes) {
          const result = await store.commit(bytes);
          bytes.fill(0);
          return result;
        }
      }
    });
    await safe.refresh();
    await safe.refresh();
    expect(target.getStatus().provenance?.sequence).toBe(1);
    safe.close();
  });

  it("validates transaction lifecycle and rejects unsupported durable configurations", () => {
    const target = provider();
    expect(() =>
      target.prepareSnapshot?.({ schemaVersion: 3 } as unknown as FlagSnapshot)
    ).toThrow();
    const transaction = target.prepareSnapshot?.(snapshot());
    expect(transaction).toBeDefined();
    transaction?.cancel();
    transaction?.cancel();
    expect(() => transaction?.commit()).toThrow("no longer active");
    target.updateSnapshot(snapshot(false));
    const accepted = target.prepareSnapshot?.(snapshot());
    accepted?.commit();
    accepted?.cancel();
    expect(() => accepted?.commit()).toThrow("no longer active");
    expect(target.getSnapshot()).toEqual(snapshot());
    expect(() => createSnapshotRefresher({ provider: target, source: source(), store })).toThrow(
      "signed verifier"
    );
    Object.defineProperty(target, "prepareSnapshot", { value: undefined });
    expect(() =>
      createSnapshotRefresher({
        provider: target,
        source: source(),
        verifier: createSnapshotVerifier(verification),
        store
      })
    ).toThrow("transactional provider");
  });
});
