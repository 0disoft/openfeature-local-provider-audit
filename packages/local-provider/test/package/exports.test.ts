import { describe, expect, it } from "vitest";
import {
  EVALUATION_REASONS,
  createEnvOverrides,
  createLocalProvider,
  evaluateFlag,
  parseJsonFlagSnapshot,
  replayEvaluationFixture
} from "../../src/index.js";

describe("package exports", () => {
  it("exposes the documented root API", () => {
    expect(typeof createLocalProvider).toBe("function");
    expect(typeof createEnvOverrides).toBe("function");
    expect(typeof evaluateFlag).toBe("function");
    expect(typeof parseJsonFlagSnapshot).toBe("function");
    expect(typeof replayEvaluationFixture).toBe("function");
    expect(EVALUATION_REASONS.STATIC).toBe("STATIC");
  });
});
