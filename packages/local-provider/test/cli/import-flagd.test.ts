import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { parseJsonFlagSnapshot, evaluateFlag } from "../../src/index.js";

const flag = { state: "ENABLED", variants: { on: true, off: false }, defaultVariant: "off" };
async function run(input: unknown, args: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "flagd-import-"));
  const path = join(cwd, "source.json");
  let stdout = "",
    stderr = "";
  try {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    if (text !== undefined) await writeFile(path, text);
    const before = text === undefined ? undefined : await stat(path, { bigint: true });
    const code = await runCli(["import-flagd", "source.json", ...args], {
      cwd,
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      }
    });
    if (before) {
      expect(await readFile(path, "utf8")).toBe(text);
      const after = await stat(path, { bigint: true });
      expect([after.ino, after.size, after.mtimeNs, after.ctimeNs]).toEqual([
        before.ino,
        before.size,
        before.mtimeNs,
        before.ctimeNs
      ]);
    }
    return { code, stdout, stderr };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("static flagd JSON import", () => {
  it("redacts names and values by default and emits only on explicit request", async () => {
    const flags = Object.fromEntries([
      ["private-flag", { ...flag, variants: { on: "private-value", off: "disabled" } }],
      ["boolean", flag],
      ["number", { ...flag, variants: { on: 2, off: -1 } }],
      ["object", { ...flag, variants: { on: { nested: [null, 1] }, off: [] } }],
      ["__proto__", flag]
    ]);
    const input = { $schema: "https://flagd.dev/schema/v0/flags.json", flags };
    const report = await run(input);
    expect(report.code).toBe(0);
    expect(JSON.parse(report.stdout)).toEqual({
      ok: true,
      sourceFormat: "flagd-static-v0",
      schemaVersion: 2,
      flagCount: 5
    });
    expect(report.stdout + report.stderr).not.toContain("private");
    const emitted = await run(input, ["--emit-snapshot"]);
    expect(emitted.code).toBe(0);
    expect(emitted.stderr).toBe("");
    const snapshot = parseJsonFlagSnapshot(emitted.stdout);
    expect(
      evaluateFlag(snapshot, {
        flagKey: "private-flag",
        expectedType: "string",
        defaultValue: "caller"
      })
    ).toMatchObject({ value: "disabled", variant: "off", reason: "STATIC" });
    expect(
      evaluateFlag(snapshot, { flagKey: "number", expectedType: "number", defaultValue: 99 })
    ).toMatchObject({ value: -1, variant: "off", reason: "STATIC" });
    expect(
      evaluateFlag(snapshot, { flagKey: "object", expectedType: "object", defaultValue: {} })
    ).toMatchObject({ value: [], variant: "off", reason: "STATIC" });
    for (const flagKey of ["boolean", "__proto__"]) {
      expect(
        evaluateFlag(snapshot, { flagKey, expectedType: "boolean", defaultValue: true })
      ).toMatchObject({ value: false, variant: "off", reason: "STATIC" });
    }
  });

  it.each([
    ["UNSUPPORTED_ROOT_FIELD", { flags: { a: flag }, metadata: {} }],
    ["UNSUPPORTED_ROOT_FIELD", { flags: { a: flag }, sharedEvaluators: {} }],
    ["UNSUPPORTED_SCHEMA", { flags: { a: flag }, $schema: "other" }],
    ["INVALID_ROOT", []],
    ["INVALID_ROOT", { flags: [] }],
    ["INVALID_FLAG", { flags: { a: null } }],
    ["UNSUPPORTED_STATE", { flags: { a: { ...flag, state: "DISABLED" } } }],
    ["UNSUPPORTED_STATE", { flags: { a: { ...flag, state: undefined } } }],
    ["UNSUPPORTED_FLAG_FIELD", { flags: { a: { ...flag, targeting: {} } } }],
    ["UNSUPPORTED_FLAG_FIELD", { flags: { a: { ...flag, metadata: {} } } }],
    ["UNSUPPORTED_FLAG_FIELD", { flags: { a: { ...flag, typo: 1 } } }],
    ["EXPLICIT_DEFAULT_REQUIRED", { flags: { a: { ...flag, defaultVariant: null } } }],
    ["EXPLICIT_DEFAULT_REQUIRED", { flags: { a: { ...flag, defaultVariant: undefined } } }],
    ["EXPLICIT_DEFAULT_REQUIRED", { flags: { a: { ...flag, defaultVariant: "missing" } } }],
    ["INVALID_VARIANTS", { flags: { a: { ...flag, variants: {} } } }],
    ["INVALID_VARIANTS", { flags: { a: { ...flag, variants: [] } } }],
    ["INCOMPATIBLE_VARIANT_TYPES", { flags: { a: { ...flag, variants: { on: true, off: 1 } } } }],
    [
      "INCOMPATIBLE_VARIANT_TYPES",
      { flags: { a: { ...flag, variants: { on: null, off: null } } } }
    ],
    ["LOCAL_SCHEMA_REJECTED", { flags: { "": flag } }]
  ])("rejects %s without partial output", async (code, input) => {
    const report = await run(input);
    expect(report.code).toBe(1);
    expect(JSON.parse(report.stdout).code).toBe(code);
    const emit = await run(input, ["--emit-snapshot"]);
    expect(emit.code).toBe(1);
    expect(emit.stdout).toBe("");
    expect(JSON.parse(emit.stderr).code).toBe(code);
  });

  it("does not emit a valid prefix of a partially unsupported file", async () => {
    const result = await run({ flags: { first: flag, private: { ...flag, targeting: null } } }, [
      "--emit-snapshot"
    ]);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      code: "UNSUPPORTED_FLAG_FIELD",
      flagIndex: 1
    });
  });
  it.each([
    ["INVALID_JSON", "{private invalid JSON"],
    ["INPUT_LIMIT", '{"flags":{"private":1e400}}'],
    ["READ_FAILED", undefined]
  ])("reports %s without raw errors", async (code, input) => {
    const result = await run(input);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe(code);
    expect(result.stdout + result.stderr).not.toContain("private");
  });
  it("enforces byte limits at the boundary", async () => {
    const input = { flags: { a: flag } };
    const length = Buffer.byteLength(JSON.stringify(input));
    expect((await run(input, ["--max-bytes", String(length)])).code).toBe(0);
    expect(JSON.parse((await run(input, ["--max-bytes", String(length - 1)])).stdout).code).toBe(
      "BYTE_LIMIT"
    );
  });
  it.each([
    ["--unknown"],
    ["--emit-snapshot", "--emit-snapshot"],
    ["--max-bytes"],
    ["--max-bytes", "0"],
    ["--max-bytes", "1.1"],
    ["--max-bytes", "104857601"],
    ["extra.json"]
  ])("rejects invalid arguments %j", async (...args) => {
    expect((await run({ flags: {} }, args)).code).toBe(2);
  });
});
