import { describe, expect, it } from "vitest";
import {
  EVALUATION_REASONS,
  createLocalProvider,
  evaluateFlag,
  parseJsonFlagSnapshot
} from "../../src/index.js";

describe("package exports", () => {
  it("exposes the documented root API", () => {
    expect(typeof createLocalProvider).toBe("function");
    expect(typeof evaluateFlag).toBe("function");
    expect(typeof parseJsonFlagSnapshot).toBe("function");
    expect(EVALUATION_REASONS.STATIC).toBe("STATIC");
  });
});
