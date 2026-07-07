import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  EVALUATION_REASONS,
  createAuditEvent,
  createEnvOverrides,
  createFileAuditSink,
  createLocalProvider,
  createReloadableLocalProvider,
  evaluateFlag,
  loadFlagSnapshotFile,
  parseJsonFlagSnapshot,
  parseYamlFlagSnapshot,
  redactContext,
  serializeAuditEvent,
  replayEvaluationFixture,
  watchFlagSnapshotFile
} from "../../src/index.js";

describe("package exports", () => {
  it("exposes the documented root API", () => {
    expect(typeof createLocalProvider).toBe("function");
    expect(typeof createReloadableLocalProvider).toBe("function");
    expect(typeof createEnvOverrides).toBe("function");
    expect(typeof evaluateFlag).toBe("function");
    expect(typeof loadFlagSnapshotFile).toBe("function");
    expect(typeof parseJsonFlagSnapshot).toBe("function");
    expect(typeof parseYamlFlagSnapshot).toBe("function");
    expect(typeof watchFlagSnapshotFile).toBe("function");
    expect(typeof replayEvaluationFixture).toBe("function");
    expect(typeof createAuditEvent).toBe("function");
    expect(typeof createFileAuditSink).toBe("function");
    expect(typeof serializeAuditEvent).toBe("function");
    expect(typeof redactContext).toBe("function");
    expect(EVALUATION_REASONS.STATIC).toBe("STATIC");
  });

  it("declares the documented CLI bin", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8")
    ) as { bin?: Record<string, string> };

    expect(packageJson.bin?.["openfeature-local-provider"]).toBe(
      "./bin/openfeature-local-provider.js"
    );
  });
});
