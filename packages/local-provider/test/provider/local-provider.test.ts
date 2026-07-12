import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCode } from "@openfeature/server-sdk";
import { describe, expect, it, vi } from "vitest";
import { createFileAuditSink } from "../../src/audit/audit-sink.js";
import {
  createLocalProvider,
  createReloadableLocalProvider
} from "../../src/provider/local-provider.js";
import { EVALUATION_REASONS } from "../../src/reasons.js";
import { staticSnapshot } from "../fixtures.js";

const logger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined
};

describe("createLocalProvider", () => {
  it("creates an OpenFeature provider with metadata", () => {
    const provider = createLocalProvider({ snapshot: staticSnapshot });

    expect(provider.metadata.name).toBe("openfeature-local-provider");
  });

  it("resolves through OpenFeature typed methods", async () => {
    const provider = createLocalProvider({ snapshot: staticSnapshot });

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      variant: "on"
    });
  });

  it("resolves number and object values through their OpenFeature methods", async () => {
    const provider = createLocalProvider({ snapshot: staticSnapshot });

    await expect(
      provider.resolveNumberEvaluation("checkout.limit", 0, {}, logger)
    ).resolves.toMatchObject({
      value: 5,
      reason: EVALUATION_REASONS.STATIC,
      variant: "standard"
    });
    await expect(
      provider.resolveObjectEvaluation("checkout.config", {}, {}, logger)
    ).resolves.toMatchObject({
      value: {
        retries: 2,
        mode: "safe"
      },
      reason: EVALUATION_REASONS.STATIC,
      variant: "default"
    });
  });

  it("updates future evaluations through a reloadable provider", async () => {
    const provider = createReloadableLocalProvider({ snapshot: staticSnapshot });

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      variant: "on"
    });

    provider.updateSnapshot({
      schemaVersion: 1,
      flags: {
        "checkout.enabled": {
          type: "boolean",
          defaultVariant: "off",
          variants: {
            on: true,
            off: false
          }
        }
      }
    });

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", true, {}, logger)
    ).resolves.toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.STATIC,
      variant: "off"
    });
  });

  it("does not let caller mutations change provider state outside updateSnapshot", async () => {
    const snapshot = {
      schemaVersion: 1,
      flags: {
        "checkout.enabled": {
          type: "boolean",
          defaultVariant: "on",
          variants: {
            on: true,
            off: false
          }
        }
      }
    } as const;
    const provider = createReloadableLocalProvider({ snapshot });

    (snapshot.flags["checkout.enabled"].variants as Record<string, boolean>).on = false;

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger)
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      variant: "on"
    });
    expect(Object.isFrozen(provider.getSnapshot().flags["checkout.enabled"]?.variants)).toBe(true);
  });

  it("validates snapshots passed to updateSnapshot", () => {
    const provider = createReloadableLocalProvider({ snapshot: staticSnapshot });

    expect(() =>
      provider.updateSnapshot({
        schemaVersion: 1,
        flags: {
          "checkout.broken": {
            type: "boolean",
            defaultVariant: "missing",
            variants: {
              on: true
            }
          }
        }
      } as never)
    ).toThrow("defaultVariant must reference an existing variant");
  });

  it("maps type mismatch to OpenFeature error details", async () => {
    const provider = createLocalProvider({ snapshot: staticSnapshot });

    await expect(
      provider.resolveStringEvaluation("checkout.enabled", "fallback", {}, logger)
    ).resolves.toMatchObject({
      value: "fallback",
      reason: EVALUATION_REASONS.ERROR,
      errorCode: ErrorCode.TYPE_MISMATCH
    });
  });

  it("uses env override options captured at provider creation", async () => {
    const env = {
      OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
    };
    const provider = createReloadableLocalProvider({
      snapshot: staticSnapshot,
      env
    });

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", true, {}, logger)
    ).resolves.toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ENV_OVERRIDE
    });

    env.OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED = "true";
    provider.updateSnapshot(staticSnapshot);

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", true, {}, logger)
    ).resolves.toMatchObject({
      value: false,
      reason: EVALUATION_REASONS.ENV_OVERRIDE
    });
  });

  it("passes OpenFeature targetingKey into rollout evaluation", async () => {
    const provider = createLocalProvider({ snapshot: staticSnapshot });

    await expect(
      provider.resolveBooleanEvaluation(
        "checkout.rollout",
        false,
        { targetingKey: "user-alpha" },
        logger
      )
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.SPLIT,
      variant: "on"
    });
  });

  it("writes redacted audit JSON Lines through the provider audit sink", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-provider-"));
    const auditPath = join(tempDirectory, "audit", "events.jsonl");

    try {
      const auditSink = createFileAuditSink({ path: auditPath });
      const provider = createLocalProvider({
        snapshot: staticSnapshot,
        auditSink
      });

      await expect(
        provider.resolveBooleanEvaluation(
          "checkout.rollout",
          false,
          {
            targetingKey: "user-alpha",
            email: "synthetic@example.test",
            tenantId: "tenant-test-1"
          },
          logger
        )
      ).resolves.toMatchObject({
        value: true,
        reason: EVALUATION_REASONS.SPLIT,
        variant: "on"
      });

      await auditSink.flush?.();

      const content = await readFile(auditPath, "utf8");
      const event = JSON.parse(content.trim());
      expect(event).toMatchObject({
        providerName: "openfeature-local-provider",
        flagKey: "checkout.rollout",
        reason: EVALUATION_REASONS.SPLIT,
        variant: "on",
        context: {
          targetingKeyPresent: true,
          keyMode: "names",
          keys: ["email", "targetingKey", "tenantId"],
          redacted: true
        }
      });
      expect(content).not.toContain("user-alpha");
      expect(content).not.toContain("synthetic@example.test");
      expect(content).not.toContain("tenant-test-1");
      expect(content).not.toContain('"value"');
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("applies strict context key redaction to provider audit events", async () => {
    let writtenEvent: unknown;
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write(event) {
          writtenEvent = event;
        }
      },
      auditWriteMode: "blocking",
      auditRedaction: { contextKeys: "none" }
    });

    await provider.resolveBooleanEvaluation(
      "checkout.rollout",
      false,
      {
        targetingKey: "user-alpha",
        email: "synthetic@example.test",
        tenantId: "tenant-test-1"
      },
      logger
    );

    expect(writtenEvent).toMatchObject({
      context: {
        targetingKeyPresent: true,
        keyMode: "none",
        keys: [],
        redacted: true
      }
    });
    const serializedEvent = JSON.stringify(writtenEvent);
    expect(serializedEvent).not.toContain("email");
    expect(serializedEvent).not.toContain("tenantId");
    expect(serializedEvent).not.toContain("user-alpha");
  });

  it("validates audit redaction options at provider creation", () => {
    expect(() =>
      createLocalProvider({
        snapshot: staticSnapshot,
        auditRedaction: { contextKeys: "values" as never }
      })
    ).toThrow("auditRedaction.contextKeys must be names, count, or none");
  });

  it("includes overrideHash on provider audit events without raw override values", async () => {
    let writtenEvent: unknown;
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
      },
      auditSink: {
        async write(event) {
          writtenEvent = event;
        }
      },
      auditWriteMode: "blocking"
    });

    await provider.resolveBooleanEvaluation("checkout.enabled", true, {}, logger);

    expect(writtenEvent).toMatchObject({
      flagKey: "checkout.enabled",
      reason: EVALUATION_REASONS.ENV_OVERRIDE
    });
    expect((writtenEvent as { overrideHash?: string }).overrideHash).toHaveLength(64);
    expect(JSON.stringify(writtenEvent)).not.toContain("OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED");
  });

  it("does not wait for non-blocking audit sink writes", async () => {
    const deferred = createDeferred();
    const writeStarted = vi.fn();
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write() {
          writeStarted();
          await deferred.promise;
        }
      }
    });

    const evaluation = provider.resolveBooleanEvaluation("checkout.enabled", false, {}, logger);

    await expect(
      Promise.race([
        evaluation.then(() => "resolved"),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50))
      ])
    ).resolves.toBe("resolved");
    expect(writeStarted).toHaveBeenCalledOnce();
    deferred.resolve();
    await deferred.promise;
  });

  it("flushes the audit sink during provider close", async () => {
    const flush = vi.fn(async () => undefined);
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write() {
          return undefined;
        },
        flush
      }
    });

    await provider.onClose?.();

    expect(flush).toHaveBeenCalledOnce();
  });

  it("does not change evaluation results when audit sink writes fail", async () => {
    const warn = vi.fn();
    const auditError = new Error("audit path is unavailable");
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write() {
          throw auditError;
        }
      },
      auditWriteMode: "blocking"
    });

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, { ...logger, warn })
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      variant: "on"
    });
    expect(warn).toHaveBeenCalledWith(
      "openfeature-local-provider audit sink write failed",
      auditError
    );
  });

  it("does not change evaluation results when audit failure logging throws", async () => {
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write() {
          throw new Error("audit path is unavailable");
        }
      },
      auditWriteMode: "blocking"
    });
    const throwingLogger = {
      ...logger,
      warn() {
        throw new Error("logger unavailable");
      }
    };

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, throwingLogger)
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      variant: "on"
    });
  });

  it("validates snapshots passed to createLocalProvider", () => {
    expect(() =>
      createLocalProvider({
        snapshot: {
          schemaVersion: 1,
          flags: {
            "checkout.broken": {
              type: "boolean",
              defaultVariant: "on",
              variants: {
                on: true
              },
              rollout: {} as never
            }
          }
        }
      })
    ).toThrow("rollout must be a non-empty array");
  });
});

function createDeferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise
  };
}
