import { ErrorCode } from "@openfeature/server-sdk";
import { describe, expect, it } from "vitest";
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
});
