import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript-api";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";

const booleanFlag = { type: "boolean", variants: { on: true, off: false }, defaultVariant: "off" };
const simple = JSON.stringify({ schemaVersion: 1, flags: { enabled: booleanFlag } });

async function generate(content: string | undefined, args = ["flags.json"], file = "flags.json") {
  const directory = await mkdtemp(join(tmpdir(), "flag-types-"));
  let stdout = "";
  let stderr = "";
  try {
    if (content !== undefined) await writeFile(join(directory, file), content, "utf8");
    const code = await runCli(["generate-types", ...args], {
      cwd: directory,
      stdout(text) {
        stdout += text;
      },
      stderr(text) {
        stderr += text;
      }
    });
    return { code, stdout, stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("CLI flag type generation", () => {
  it.each([1, 2])(
    "generates deterministic, value-redacted types for schema %i",
    async (schemaVersion) => {
      const flags = {
        z: { type: "string", variants: { a: "private-variant-value" }, defaultVariant: "a" },
        a: booleanFlag,
        n: { type: "number", variants: { a: 1 }, defaultVariant: "a" }
      };
      const first = await generate(JSON.stringify({ schemaVersion, flags }));
      const second = await generate(
        JSON.stringify({
          schemaVersion,
          flags: Object.fromEntries(Object.entries(flags).reverse())
        })
      );
      expect(first.code).toBe(0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe(second.stdout);
      expect(first.stdout).toContain('readonly "a": boolean;');
      expect(first.stdout).toContain('readonly "n": number;');
      expect(first.stdout).toContain('readonly "z": string;');
      expect(first.stdout.indexOf('"a"')).toBeLessThan(first.stdout.indexOf('"z"'));
      expect(first.stdout).not.toContain("private-variant-value");
      expect(first.stdout).not.toContain("type JsonValue");
    }
  );

  it("compiles standalone declarations and rejects unknown keys and incorrect values", async () => {
    const unusual = 'quote"\\\n*/\u2028\u2029😀';
    const flags = Object.fromEntries([
      ["enabled", booleanFlag],
      ["constructor", booleanFlag],
      ["__proto__", booleanFlag],
      [unusual, booleanFlag],
      ["long".repeat(100), booleanFlag],
      ["label", { type: "string", variants: { a: "configured" }, defaultVariant: "a" }],
      [
        "data",
        {
          type: "object",
          variants: { a: { secret: "private-payload" }, b: [] },
          defaultVariant: "a"
        }
      ]
    ]);
    const generated = await generate(JSON.stringify({ schemaVersion: 2, flags }));
    expect(generated.code).toBe(0);
    expect(generated.stdout).not.toContain("private-payload");
    expect(generated.stdout).not.toContain("\u2028");
    expect(generated.stdout).toContain("\\u2028");
    const directory = await mkdtemp(join(tmpdir(), "flag-types-compile-"));
    try {
      await writeFile(join(directory, "flags.d.ts"), generated.stdout, "utf8");
      const consumer = join(directory, "consumer.mts");
      await writeFile(
        consumer,
        `import type { FlagKey, FlagValue } from "./flags.js";
const enabled: FlagValue<"enabled"> = true;
const override: FlagValue<"label"> = "not-in-configured-variants";
const objectOverride: FlagValue<"data"> = { differentShape: [null, 1, false] };
const arrayOverride: FlagValue<"data"> = ["different", { value: null }];
const quoted: FlagKey = ${JSON.stringify(unusual)};
const special: FlagValue<"__proto__"> = false;
const constructorFlag: FlagValue<"constructor"> = true;
// @ts-expect-error unknown key must fail
const missing: FlagKey = "missing";
// @ts-expect-error incorrect declared value type must fail
const wrong: FlagValue<"enabled"> = "true";
// @ts-expect-error object variant roots cannot be null
const nullRoot: FlagValue<"data"> = null;
// @ts-expect-error missing key cannot index value type
const invalid: FlagValue<"missing"> = true;
void [enabled, override, objectOverride, arrayOverride, quoted, special, constructorFlag, missing, wrong, nullRoot, invalid];
`,
        "utf8"
      );
      const program = ts.createProgram([consumer], {
        strict: true,
        noEmit: true,
        types: [],
        lib: ["lib.es2022.d.ts"],
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(
        diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n"))
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(
    [["--format", "yaml"], ["--format=yaml"], ["--format=auto"]].map((options) => ({ options }))
  )("supports YAML and explicit format options %j", async ({ options }) => {
    const result = await generate(
      "schemaVersion: 1\nflags:\n  enabled:\n    type: boolean\n    variants: {on: true, off: false}\n    defaultVariant: off\n",
      ["flags.yaml", ...options],
      "flags.yaml"
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('readonly "enabled": boolean;');
  });

  it("supports an empty validated snapshot", async () => {
    const result = await generate('{"schemaVersion":2,"flags":{}}');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("export interface FlagValues");
    expect(result.stdout).not.toContain("type JsonValue");
  });

  it.each(["--help", "-h"])("prints command help for %s", async (help) => {
    const result = await generate(undefined, [help]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("generate-types <file>");
  });

  it.each(
    [
      [],
      [""],
      ["flags.json", "extra.json"],
      ["--unknown"],
      ["flags.json", "--format"],
      ["flags.json", "--format=toml"]
    ].map((args) => ({ args }))
  )("rejects invalid usage without declarations $args", async ({ args }) => {
    const result = await generate(simple, args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage error");
  });

  it.each([
    undefined,
    "private-malformed-payload",
    JSON.stringify({
      schemaVersion: 1,
      flags: { enabled: { ...booleanFlag, defaultVariant: "missing" } }
    })
  ])("does not emit declarations or expose errors for invalid input (%#)", async (content) => {
    const result = await generate(content);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Type generation failed: snapshot is invalid or unreadable.\n");
  });
});
