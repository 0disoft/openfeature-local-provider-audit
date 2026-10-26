import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { ProviderEvents } from "@openfeature/server-sdk";
import { createHistoricalSnapshotVerifier } from "../../src/sources/signed-snapshot.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReloadableLocalProvider,
  createSnapshotRefresher,
  createSnapshotVerifier,
  signFlagSnapshot,
  type AuditEvent,
  type FlagSnapshot,
  type SignFlagSnapshotOptions,
  type SnapshotSource,
  type SnapshotVerificationOptions
} from "../../src/index.js";

const NOW = 1_800_000_000_000;
const TYPE = "openfeature-local-snapshot+jws";
const keys = generateKeyPairSync("ed25519");
const rotated = generateKeyPairSync("ed25519");
const logger = { debug() {}, info() {}, warn() {}, error() {} };
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

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
function signOptions(extra: Partial<SignFlagSnapshotOptions> = {}): SignFlagSnapshotOptions {
  return {
    snapshot: snapshot(),
    privateKey: keys.privateKey,
    keyId: "release-1",
    audience: "service/production",
    sequence: 1,
    issuedAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    ...extra
  };
}
function verifier(extra: Partial<SnapshotVerificationOptions> = {}) {
  return createSnapshotVerifier({
    audience: "service/production",
    trustedKeys: { "release-1": keys.publicKey },
    ...extra
  });
}
function bytes(token: string) {
  return Buffer.from(token, "utf8");
}

// Independently construct/sign JWS rather than only round-tripping the package signer.
function externalToken(
  claimsExtra: Record<string, unknown> = {},
  headerExtra: Record<string, unknown> = {},
  key: KeyObject = keys.privateKey
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "Ed25519", kid: "release-1", typ: TYPE, ...headerExtra })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      audience: "service/production",
      sequence: 1,
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      snapshot: snapshot(),
      ...claimsExtra
    })
  ).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`;
}

describe("signed snapshots", () => {
  it.each([
    { name: "fresh", create: createSnapshotVerifier },
    { name: "historical", create: createHistoricalSnapshotVerifier }
  ])(
    "bounds separator allocation in the $name verifier without accepting suffixes",
    ({ create }) => {
      const check = create({
        audience: "service/production",
        trustedKeys: { "release-1": keys.publicKey }
      });
      const valid = externalToken();
      expect(check.verify(bytes(valid)).provenance.sequence).toBe(1);
      for (const suffix of [".", ".extra", "..ignored"])
        expect(() => check.verify(bytes(valid + suffix))).toThrow("verification failed");
      const malformed = ".".repeat(100_000);
      const split = String.prototype.split;
      let materialized = 0;
      const observe = vi.spyOn(String.prototype, "split").mockImplementation(function (
        this: string,
        separator: unknown,
        limit?: number
      ) {
        const parts: string[] = Reflect.apply(split, this, [separator, limit]);
        if (this === malformed && separator === ".")
          materialized = Math.max(materialized, parts.length);
        return parts;
      });
      try {
        expect(() => check.verify(bytes(malformed))).toThrow("verification failed");
      } finally {
        observe.mockRestore();
      }
      expect(materialized).toBeLessThanOrEqual(4);
    }
  );

  it("produces Ed25519 compact JWS accepted by native crypto and verifies independent JWS", () => {
    const token = signFlagSnapshot(signOptions());
    const [header, payload, signature] = token.split(".");
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        keys.publicKey,
        Buffer.from(signature ?? "", "base64url")
      )
    ).toBe(true);
    const result = verifier().verify(bytes(externalToken()));
    expect(result.snapshot).toEqual(snapshot());
    expect(result.provenance).toMatchObject({
      audience: "service/production",
      sequence: 1,
      keyId: "release-1",
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      artifactHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.snapshot.flags)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
  });

  it("captures pinned PEM/KeyObject keys and supports explicit rotation without key discovery", () => {
    const trustedKeys: Record<string, string | KeyObject> = {
      "release-1": keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      "release-2": rotated.publicKey
    };
    const check = verifier({ trustedKeys });
    delete trustedKeys["release-1"];
    const first = check.verify(bytes(signFlagSnapshot(signOptions())));
    const next = signFlagSnapshot(
      signOptions({ keyId: "release-2", privateKey: rotated.privateKey, sequence: 2 })
    );
    expect(check.verify(bytes(next), first.provenance).provenance.keyId).toBe("release-2");
    const revoked = verifier({ trustedKeys: { "release-2": rotated.publicKey } });
    expect(() => revoked.verify(bytes(signFlagSnapshot(signOptions())))).toThrow(
      "verification failed"
    );
  });

  it.each([
    { alg: "none" },
    { alg: "EdDSA" },
    { alg: "HS256" },
    { typ: "JWT" },
    { kid: "unknown" },
    { kid: "../private" },
    { jku: "https://example.test/keys" },
    { crit: ["custom"] }
  ])("rejects algorithm/key/domain/header substitution %j", (header) => {
    expect(() => verifier().verify(bytes(externalToken({}, header)))).toThrow(
      "verification failed"
    );
  });

  it.each([
    { audience: "service/staging" },
    { sequence: -1 },
    { sequence: 1.5 },
    { issuedAt: NOW + 30_001 },
    { expiresAt: NOW },
    { issuedAt: NOW - 7 * 86_400_000 - 1, expiresAt: NOW + 1 },
    { expiresAt: NOW + 8 * 86_400_000 },
    { schemaVersion: 2 },
    { snapshot: { schemaVersion: 99, flags: {} } },
    { ignored: "private" }
  ])("rejects authenticated but invalid claims %j", (claims) => {
    expect(() => verifier().verify(bytes(externalToken(claims)))).toThrow("verification failed");
  });

  it("rejects payload/signature corruption, noncanonical base64 and malformed framing", () => {
    const token = externalToken();
    const [header = "", payload = "", signature = ""] = token.split(".");
    const flip = (value: string) => (value[0] === "A" ? "B" : "A") + value.slice(1);
    for (const invalid of [
      `${header}.${flip(payload)}.${signature}`,
      `${header}.${payload}.${flip(signature)}`,
      `${header}.${payload}.${signature}=`,
      "not.jws",
      "a.b.c",
      `${"a".repeat(1_025)}.${payload}.${signature}`
    ])
      expect(() => verifier().verify(bytes(invalid))).toThrow("verification failed");
    // A properly signed padded payload still violates the strict base64url profile.
    const padded = `${header}.${payload}=`;
    const paddedToken = `${padded}.${sign(null, Buffer.from(padded), keys.privateKey).toString("base64url")}`;
    expect(() => verifier().verify(bytes(paddedToken))).toThrow("verification failed");
  });

  it("enforces minimum/previous sequence, detects equivocation and permits identical revalidation", () => {
    const check = verifier({ minSequence: 1 });
    const first = check.verify(bytes(externalToken()));
    expect(check.verify(bytes(`\n${externalToken()}\n`), first.provenance).provenance).toEqual(
      first.provenance
    );
    for (const claims of [
      { sequence: 0 },
      { snapshot: snapshot(false) },
      { issuedAt: NOW - 500 },
      { sequence: 2, issuedAt: NOW - 2_000 }
    ])
      expect(() => check.verify(bytes(externalToken(claims)), first.provenance)).toThrow();
    expect(() =>
      check.verify(bytes(externalToken()), { ...first.provenance, audience: "other" })
    ).toThrow();
    expect(
      check.verify(bytes(externalToken({ sequence: 2 })), first.provenance).provenance.sequence
    ).toBe(2);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    expect(() => check.verify(bytes(externalToken()), first.provenance)).toThrow();
  });

  it("validates limits, trust material and signer input without leaking supplied data", () => {
    const wrong = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    for (const trustedKeys of [
      {},
      { bad: keys.privateKey },
      { bad: wrong.publicKey },
      { bad: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      { bad: "private malformed key" },
      Object.fromEntries(Array.from({ length: 33 }, (_, i) => [String(i), keys.publicKey]))
    ])
      expect(() => verifier({ trustedKeys })).toThrow("trustedKeys requires");
    for (const extra of [
      { audience: "" },
      { minSequence: -1 },
      { maxAgeMs: 0 },
      { maxLifetimeMs: 0 },
      { clockSkewMs: 300_001 },
      { maxBytes: 0 }
    ])
      expect(() => verifier(extra)).toThrow();
    for (const extra of [
      { privateKey: keys.publicKey },
      { keyId: "private invalid" },
      { audience: "" },
      { sequence: Number.NaN },
      { expiresAt: NOW - 2_000 },
      { maxBytes: 1 }
    ])
      expect(() => signFlagSnapshot(signOptions(extra))).toThrow();
    expect(() => verifier({ maxBytes: 1 }).verify(bytes(externalToken()))).toThrow();
    vi.mocked(Date.now).mockReturnValue(Number.NaN);
    expect(() => verifier().verify(bytes(externalToken()))).toThrow();
  });

  it("commits provenance with the matching audit hash and rechecks expiry on 304", async () => {
    const events: AuditEvent[] = [];
    const provider = createReloadableLocalProvider({
      snapshot: snapshot(false),
      env: {},
      auditSink: {
        async write(event) {
          events.push(event);
        }
      },
      auditWriteMode: "blocking"
    });
    const token = signFlagSnapshot(signOptions());
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({ status: "content", content: bytes(token), etag: '"signed"' })
      .mockResolvedValue({ status: "notModified" });
    const refresher = createSnapshotRefresher({
      provider,
      source: { fetch },
      verifier: verifier()
    });
    const result = await refresher.refresh();
    expect(result.provenance?.sequence).toBe(1);
    expect(refresher.getProvenance()).toEqual(result.provenance);
    await provider.resolveBooleanEvaluation(
      "feature",
      false,
      { targetingKey: "private-user" },
      logger
    );
    expect(events[0]?.snapshotHash).toBe(result.provenance?.snapshotHash);
    expect(events[0]?.provenance).toEqual(result.provenance);
    expect(JSON.stringify(events)).not.toContain("private-user");
    await refresher.refresh();
    const successful = provider.getStatus().successfulRefreshes;
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(provider.getStatus()).toMatchObject({
      successfulRefreshes: successful,
      failedRefreshes: 1,
      lastRefreshFailure: "signature"
    });
    await expect(
      provider.resolveBooleanEvaluation("feature", false, {}, logger)
    ).resolves.toMatchObject({ value: true });
    provider.updateSnapshot(snapshot(false));
    expect(refresher.getProvenance()).toBeUndefined();
    refresher.close();
  });

  it("does not advance provenance or validator on reentrant application failure", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const first = signFlagSnapshot(signOptions({ snapshot: snapshot(false) }));
    const second = signFlagSnapshot(signOptions({ sequence: 2 }));
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({ status: "content", content: bytes(first), etag: '"one"' })
      .mockResolvedValueOnce({ status: "content", content: bytes(second), etag: '"two"' })
      .mockResolvedValueOnce({ status: "content", content: bytes(first), etag: '"one"' });
    const refresher = createSnapshotRefresher({
      provider,
      source: { fetch },
      verifier: verifier()
    });
    await refresher.refresh();
    let replaced = false;
    provider.events?.addHandler(ProviderEvents.ConfigurationChanged, () => {
      if (!replaced) {
        replaced = true;
        provider.updateSnapshot(snapshot(false));
      }
    });
    await expect(refresher.refresh()).rejects.toThrow("during application");
    expect(refresher.getProvenance()).toBeUndefined();
    await refresher.refresh();
    expect(fetch.mock.calls[2]?.[0]?.etag).toBeUndefined();
    expect(refresher.getProvenance()?.sequence).toBe(1);
  });

  it("fails signed refresh without falling back to unsigned JSON, and forbids YAML", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const source: SnapshotSource = {
      fetch: async () => ({ status: "content", content: bytes(JSON.stringify(snapshot())) })
    };
    const refresher = createSnapshotRefresher({ provider, source, verifier: verifier() });
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(provider.getStatus().lastRefreshFailure).toBe("signature");
    expect(provider.getSnapshot()).toEqual(snapshot(false));
    expect(() =>
      createSnapshotRefresher({ provider, source, verifier: verifier(), format: "yaml" })
    ).toThrow();
  });
});

describe("atomic signed artifact provenance", () => {
  function release(sequence: number, enabled = true) {
    return verifier().verify(
      bytes(signFlagSnapshot(signOptions({ sequence, snapshot: snapshot(enabled) })))
    );
  }

  it("distinguishes identical snapshots, captures pending audit origin and clears unsigned origin", async () => {
    const first = release(1),
      second = release(2);
    const events: AuditEvent[] = [];
    let settle!: () => void;
    const provider = createReloadableLocalProvider({
      ...first,
      env: {},
      auditWriteMode: "blocking",
      auditSink: {
        write(event) {
          events.push(event);
          return new Promise<void>((resolve) => {
            settle = resolve;
          });
        }
      }
    });
    const changed = vi.fn();
    provider.events?.addHandler(ProviderEvents.ConfigurationChanged, changed);
    const evaluation = provider.resolveBooleanEvaluation("feature", false, {}, logger);
    provider.updateSnapshot(second.snapshot, second.provenance);
    expect(provider.getStatus().provenance).toEqual(second.provenance);
    expect(events[0]?.provenance).toEqual(first.provenance);
    expect(first.provenance.snapshotHash).toBe(second.provenance.snapshotHash);
    expect(first.provenance.artifactHash).not.toBe(second.provenance.artifactHash);
    settle();
    await evaluation;
    const next = provider.resolveBooleanEvaluation("feature", false, {}, logger);
    expect(events[1]?.provenance).toEqual(second.provenance);
    settle();
    await next;
    provider.updateSnapshot(second.snapshot);
    expect(provider.getStatus().provenance).toBeUndefined();
    const unsigned = provider.resolveBooleanEvaluation("feature", false, {}, logger);
    expect(events[2]?.provenance).toBeUndefined();
    settle();
    await unsigned;
    expect(changed).not.toHaveBeenCalled();
  });

  it("copies only validated data fields and preserves state on invalid origin", () => {
    const first = release(1);
    const metadata = { ...first.provenance, rawContext: "must-not-copy" };
    const provider = createReloadableLocalProvider({
      snapshot: first.snapshot,
      provenance: metadata,
      env: {}
    });
    const captured = provider.getStatus().provenance;
    metadata.sequence = 99;
    expect(captured?.sequence).toBe(1);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(JSON.stringify(captured)).not.toContain("must-not-copy");
    const getter = vi.fn(() => 1);
    const accessor = { ...first.provenance };
    Object.defineProperty(accessor, "sequence", { get: getter });
    const invalid = [
      accessor,
      { ...first.provenance, sequence: -1 },
      { ...first.provenance, artifactHash: "bad" },
      { ...first.provenance, expiresAt: 0 },
      { ...first.provenance, keyId: "bad/key" },
      { ...first.provenance, audience: "bad space" }
    ];
    for (const provenance of invalid)
      expect(() => provider.updateSnapshot(first.snapshot, provenance)).toThrow(
        "Snapshot provenance is invalid."
      );
    expect(getter).not.toHaveBeenCalled();
    expect(provider.getStatus().provenance).toBe(captured);
    expect(provider.getStatus().failedRefreshes).toBe(invalid.length);
    expect(() => provider.updateSnapshot(snapshot(false), captured)).toThrow(
      "Snapshot provenance is invalid."
    );
    expect(() =>
      createReloadableLocalProvider({ snapshot: snapshot(false), provenance: first.provenance })
    ).toThrow();
  });

  it("publishes provenance before configuration callbacks and rejects equal-hash reentrant clearing", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    let observed: number | undefined;
    provider.events?.addHandler(ProviderEvents.ConfigurationChanged, () => {
      observed = provider.getStatus().provenance?.sequence;
      provider.updateSnapshot(provider.getSnapshot());
    });
    const refresher = createSnapshotRefresher({
      provider,
      verifier: verifier(),
      source: {
        async fetch() {
          return { status: "content", content: bytes(signFlagSnapshot(signOptions())) };
        }
      }
    });
    await expect(refresher.refresh()).rejects.toThrow("during application");
    expect(observed).toBe(1);
    expect(provider.getStatus().provenance).toBeUndefined();
    expect(refresher.getProvenance()).toBeUndefined();
    refresher.close();
  });

  it("retains initial signed continuity after an unsigned equal-hash update", async () => {
    const first = release(3);
    const provider = createReloadableLocalProvider({ ...first, env: {} });
    const refresher = createSnapshotRefresher({
      provider,
      verifier: verifier(),
      source: {
        async fetch() {
          return {
            status: "content",
            content: bytes(signFlagSnapshot(signOptions({ sequence: 2 })))
          };
        }
      }
    });
    provider.updateSnapshot(first.snapshot);
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(provider.getStatus().provenance).toBeUndefined();
    expect(refresher.getProvenance()).toBeUndefined();
    refresher.close();
  });

  it("uses initial provider provenance as a replay floor and detects same-hash changes during fetch", async () => {
    const first = release(3);
    const provider = createReloadableLocalProvider({ ...first, env: {} });
    let complete!: (result: Awaited<ReturnType<SnapshotSource["fetch"]>>) => void;
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValue({
        status: "content",
        content: bytes(signFlagSnapshot(signOptions({ sequence: 2 })))
      });
    const refresher = createSnapshotRefresher({
      provider,
      source: { fetch },
      verifier: verifier()
    });
    const pending = refresher.refresh();
    await Promise.resolve();
    const newer = release(4);
    provider.updateSnapshot(newer.snapshot, newer.provenance);
    complete({ status: "content", content: bytes(signFlagSnapshot(signOptions({ sequence: 5 }))) });
    await expect(pending).rejects.toThrow("during refresh");
    await expect(refresher.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(provider.getStatus().provenance?.sequence).toBe(4);
    refresher.close();
  });
});
