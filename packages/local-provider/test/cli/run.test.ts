import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../../src/cli/run.js";

describe("CLI runner", () => {
  it.each([
    { args: [] },
    { args: ["help"] },
    { args: ["--help"] },
    { args: ["-h"] }
  ])("prints top-level help for $args", async ({ args }) => {
    const io = createIo(process.cwd());

    const code = await runCli(args, io);

    expect(code).toBe(0);
    expect(io.output()).toContain("openfeature-local-provider validate <file>");
    expect(io.error()).toBe("");
  });

  it.each([
    { args: ["--version"] },
    { args: ["-v"] }
  ])("prints the package version for $args", async ({ args }) => {
    const io = createIo(process.cwd());

    const code = await runCli(args, io);

    expect(code).toBe(0);
    expect(io.output()).toBe("0.0.0-test\n");
    expect(io.error()).toBe("");
  });

  it.each([
    { args: ["validate", "--help"] },
    { args: ["validate", "-h"] }
  ])("prints validate help for $args", async ({ args }) => {
    const io = createIo(process.cwd());

    const code = await runCli(args, io);

    expect(code).toBe(0);
    expect(io.output()).toContain("--format auto|json|yaml");
    expect(io.error()).toBe("");
  });

  it("validates a JSON flag snapshot", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-cli-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, createJsonSnapshot(), "utf8");
      const io = createIo(tempDirectory);

      const code = await runCli(["validate", "flags.json"], io);

      expect(code).toBe(0);
      expect(io.output()).toContain("OK flags.json schemaVersion=1 flags=1 format=json");
      expect(io.error()).toBe("");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("prints a JSON validation summary", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-cli-"));
    try {
      const path = join(tempDirectory, "flags.yaml");
      await writeFile(path, createYamlSnapshot(), "utf8");
      const io = createIo(tempDirectory);

      const code = await runCli(["validate", "flags.yaml", "--json"], io);

      expect(code).toBe(0);
      expect(JSON.parse(io.output())).toEqual({
        ok: true,
        path: "flags.yaml",
        format: "yaml",
        requestedFormat: "auto",
        schemaVersion: 1,
        flags: 1
      });
      expect(io.error()).toBe("");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("supports explicit format selection", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-cli-"));
    try {
      const path = join(tempDirectory, "flags.txt");
      await writeFile(path, createYamlSnapshot(), "utf8");
      const io = createIo(tempDirectory);

      const code = await runCli(["validate", "flags.txt", "--format=yaml"], io);

      expect(code).toBe(0);
      expect(io.output()).toContain("flags=1");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("returns a validation error without printing file contents", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openfeature-local-provider-cli-"));
    try {
      const path = join(tempDirectory, "flags.json");
      await writeFile(path, '{"secret":"do-not-print"}', "utf8");
      const io = createIo(tempDirectory);

      const code = await runCli(["validate", "flags.json"], io);

      expect(code).toBe(1);
      expect(io.output()).toBe("");
      expect(io.error()).toContain("Invalid flag snapshot:");
      expect(io.error()).not.toContain("do-not-print");
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    [["unknown"], "Unknown command: unknown"],
    [["validate"], "validate requires a file path"],
    [["validate", "--format"], "--format requires one of: auto, json, yaml"],
    [["validate", "--format", "toml"], "Unsupported format: toml"],
    [["validate", "--format=toml", "flags.json"], "Unsupported format: toml"],
    [["validate", "--verbose", "flags.json"], "Unknown option: --verbose"],
    [["validate", "one.json", "two.json"], "validate accepts exactly one file path"]
  ] as const)("returns usage error for %j", async (args, message) => {
    const io = createIo(process.cwd());

    const code = await runCli(args, io);

    expect(code).toBe(2);
    expect(io.output()).toBe("");
    expect(io.error()).toContain(`Usage error: ${message}`);
  });
});

function createIo(cwd: string): CliIo & { output(): string; error(): string } {
  let stdout = "";
  let stderr = "";

  return {
    cwd,
    packageVersion: "0.0.0-test",
    stdout(text) {
      stdout += text;
    },
    stderr(text) {
      stderr += text;
    },
    output() {
      return stdout;
    },
    error() {
      return stderr;
    }
  };
}

function createJsonSnapshot(): string {
  return JSON.stringify({
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
  });
}

function createYamlSnapshot(): string {
  return `
schemaVersion: 1
flags:
  checkout.enabled:
    type: boolean
    defaultVariant: "on"
    variants:
      "on": true
      "off": false
`;
}
