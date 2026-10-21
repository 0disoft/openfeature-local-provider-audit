import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenFeature } from "@openfeature/server-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createHmacAuditPseudonymizer,
  createAuditEvent,
  createAuditChainCheckpoint,
  createChainedAuditEvent,
  createChainedFileAuditSink,
  createLocalProvider,
  evaluateFlag,
  serializeAuditEvent,
  verifyAuditChain,
  type AuditPseudonym,
  type AuditPseudonymizer,
  type ChainedAuditEvent,
  type HmacAuditPseudonymizerOptions
} from "../../src/index.js";
import { staticSnapshot } from "../fixtures.js";

function event(pseudonymizer?: AuditPseudonymizer, targetingKey?: string) {
  const request = {
    flagKey: "checkout.enabled",
    expectedType: "boolean" as const,
    defaultValue: false,
    ...(targetingKey !== undefined ? { targetingKey } : {})
  };
  return createAuditEvent({
    snapshot: staticSnapshot,
    request,
    result: evaluateFlag(staticSnapshot, request),
    providerName: "test",
    ...(pseudonymizer !== undefined ? { pseudonymizer } : {})
  });
}
const logger = { warn() {}, debug() {}, info() {}, error() {} };

describe("opt-in HMAC audit pseudonyms", () => {
  it("matches native HMAC bytes, captures secret material and separates key IDs/scopes/rotation", () => {
    const key = randomBytes(32),
      saved = Buffer.from(key);
    const options = { key, keyId: "release-1", scope: "production/tenant-a" };
    const pseudonymizer = createHmacAuditPseudonymizer(options);
    const subject = "subject/사용자";
    const expected = createHmac("sha256", saved)
      .update("openfeature-local-audit-subject/v1\0")
      .update(JSON.stringify([options.keyId, options.scope, subject]), "utf8")
      .digest("hex");
    key.fill(0);
    options.keyId = "changed";
    options.scope = "changed";
    expect(pseudonymizer.pseudonymize(subject)).toEqual({
      schemaVersion: 1,
      keyId: "release-1",
      scope: "production/tenant-a",
      hash: expected
    });
    expect(pseudonymizer.pseudonymize(subject)?.hash).toBe(expected);
    for (const change of [
      { keyId: "release-2" },
      { scope: "production/tenant-b" },
      { key: randomBytes(32) }
    ])
      expect(
        createHmacAuditPseudonymizer({
          key: saved,
          keyId: "release-1",
          scope: "production/tenant-a",
          ...change
        }).pseudonymize(subject)?.hash
      ).not.toBe(expected);
    expect(Object.isFrozen(pseudonymizer.pseudonymize(subject))).toBe(true);
    expect(JSON.stringify(pseudonymizer)).toBe("{}");
    expect(pseudonymizer.pseudonymize("")).toBeUndefined();
  });

  it("rejects invalid bounds/Unicode and custom metadata without invoking getters or exposing input", () => {
    const options = { key: randomBytes(32), keyId: "active", scope: "production" };
    for (const invalid of [
      { key: randomBytes(31) },
      { key: randomBytes(129) },
      { key: "private" },
      { keyId: "private value" },
      { scope: "" }
    ])
      expect(() =>
        createHmacAuditPseudonymizer({ ...options, ...invalid } as HmacAuditPseudonymizerOptions)
      ).toThrow("Audit pseudonyms require");
    const pseudonymizer = createHmacAuditPseudonymizer(options);
    for (const invalid of ["private".repeat(2000), "가".repeat(3000), "\ud800", "\udc00", 1])
      expect(() => pseudonymizer.pseudonymize(invalid as string)).toThrow(
        "Audit subject is invalid."
      );
    const valid = pseudonymizer.pseudonymize("subject");
    const getter = vi.fn(() => "private");
    const accessor = { ...valid };
    Object.defineProperty(accessor, "hash", { get: getter });
    for (const invalid of [
      accessor,
      { ...valid, subject: "private" },
      { ...valid, hash: "private" },
      { ...valid, schemaVersion: 2 },
      { ...valid, scope: "" },
      null
    ])
      expect(() => event({ pseudonymize: () => invalid as AuditPseudonym }, "subject")).toThrow(
        "Audit pseudonym metadata is invalid."
      );
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      createLocalProvider({
        snapshot: staticSnapshot,
        auditPseudonymizer: {} as AuditPseudonymizer
      })
    ).toThrow("pseudonymize");
  });

  it("keeps default/no-subject events uncorrelated and authenticates strict pseudonym fields in chains", () => {
    const pseudonymizer = createHmacAuditPseudonymizer({
      key: randomBytes(32),
      keyId: "active",
      scope: "production"
    });
    expect(Object.hasOwn(event(undefined, "private"), "pseudonym")).toBe(false);
    expect(Object.hasOwn(event(pseudonymizer), "pseudonym")).toBe(false);
    expect(Object.hasOwn(event(pseudonymizer, ""), "pseudonym")).toBe(false);
    const input = event(pseudonymizer, "private"),
      start = createAuditChainCheckpoint("test");
    expect(serializeAuditEvent(input)).not.toContain("private");
    const record = createChainedAuditEvent(input, start);
    expect(verifyAuditChain([record], { start }).records).toBe(1);
    expect(() =>
      verifyAuditChain(
        [
          {
            ...record,
            event: { ...record.event, pseudonym: { ...input.pseudonym, scope: "changed" } }
          }
        ],
        { start }
      )
    ).toThrow();
    expect(() =>
      createChainedAuditEvent(
        { ...input, pseudonym: { ...input.pseudonym, raw: "private" } } as unknown as typeof input,
        start
      )
    ).toThrow();
  });

  it("composes with actual SDK/confirmed chain storage and preserves audit failure policies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "of-pseudonym-"));
    const pseudonymizer = createHmacAuditPseudonymizer({
      key: randomBytes(32),
      keyId: "active",
      scope: "production"
    });
    const sink = createChainedFileAuditSink({ directory, chainId: "test" });
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {},
      auditSink: sink,
      auditFailurePolicy: "returnDefault",
      auditTimeoutMs: 10000,
      auditPseudonymizer: pseudonymizer
    });
    try {
      await OpenFeature.setProviderAndWait("pseudonym", provider);
      expect(
        await OpenFeature.getClient("pseudonym").getBooleanValue("checkout.enabled", false, {
          targetingKey: "private-subject",
          email: "private-mail"
        })
      ).toBe(true);
      const checkpoint = await sink.getCheckpoint();
      const rows = JSON.parse(
        (await readFile(join(directory, checkpoint.files[0] ?? ""), "utf8")).trim()
      ) as ChainedAuditEvent;
      expect(rows.event.pseudonym).toEqual(pseudonymizer.pseudonymize("private-subject"));
      expect(JSON.stringify(rows)).not.toContain("private-");
      expect(
        verifyAuditChain([rows], { start: checkpoint.start, expectedHead: checkpoint.head })
          .checkpointMatched
      ).toBe(true);
      const context = { targetingKey: "x".repeat(8193) };
      expect(
        await provider.resolveBooleanEvaluation("checkout.enabled", false, context, logger)
      ).toMatchObject({ value: false, errorCode: "GENERAL" });
      const bestEffort = createLocalProvider({
        snapshot: staticSnapshot,
        env: {},
        auditSink: sink,
        auditWriteMode: "blocking",
        auditPseudonymizer: pseudonymizer
      });
      expect(
        await bestEffort.resolveBooleanEvaluation("checkout.enabled", false, context, logger)
      ).toMatchObject({ value: true });
      expect(bestEffort.getStatus().audit.failedWrites).toBe(1);
      expect(provider.getStatus().audit.failedWrites).toBe(1);
      expect((await sink.getCheckpoint()).head.sequence).toBe(1);
      await bestEffort.onClose?.();
    } finally {
      await OpenFeature.clearProviders();
      expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-pseudonym-"))).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
