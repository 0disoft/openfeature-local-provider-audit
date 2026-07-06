import { ErrorCode } from "@openfeature/server-sdk";
import { describe, expect, it, vi } from "vitest";
import { createLocalProvider } from "../../src/provider/local-provider.js";
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
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      env: {
        OPENFEATURE_LOCAL_FLAG_CHECKOUT_ENABLED: "false"
      }
    });

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

  it("does not change evaluation results when audit sink writes fail", async () => {
    const warn = vi.fn();
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write() {
          throw new Error("audit path is unavailable");
        }
      }
    });

    await expect(
      provider.resolveBooleanEvaluation("checkout.enabled", false, {}, { ...logger, warn })
    ).resolves.toMatchObject({
      value: true,
      reason: EVALUATION_REASONS.STATIC,
      variant: "on"
    });
    expect(warn).toHaveBeenCalledWith("openfeature-local-provider audit sink write failed");
  });

  it("does not change evaluation results when audit failure logging throws", async () => {
    const provider = createLocalProvider({
      snapshot: staticSnapshot,
      auditSink: {
        async write() {
          throw new Error("audit path is unavailable");
        }
      }
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
});
