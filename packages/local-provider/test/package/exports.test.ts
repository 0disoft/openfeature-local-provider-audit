import { describe, expect, it } from "vitest";
import {
  EVALUATION_REASONS,
  createAuditEvent,
  createEnvOverrides,
  createFileAuditSink,
  createLocalProvider,
  evaluateFlag,
  parseJsonFlagSnapshot,
  parseYamlFlagSnapshot,
  redactContext,
  serializeAuditEvent,
  replayEvaluationFixture
} from "../../src/index.js";

describe("package exports", () => {
  it("exposes the documented root API", () => {
    expect(typeof createLocalProvider).toBe("function");
    expect(typeof createEnvOverrides).toBe("function");
    expect(typeof evaluateFlag).toBe("function");
    expect(typeof parseJsonFlagSnapshot).toBe("function");
    expect(typeof parseYamlFlagSnapshot).toBe("function");
    expect(typeof replayEvaluationFixture).toBe("function");
    expect(typeof createAuditEvent).toBe("function");
    expect(typeof createFileAuditSink).toBe("function");
    expect(typeof serializeAuditEvent).toBe("function");
    expect(typeof redactContext).toBe("function");
    expect(EVALUATION_REASONS.STATIC).toBe("STATIC");
  });
});
