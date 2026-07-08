import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../../src/cli/run.js";

describe("CLI runner", () => {
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

      const code = await runCli(["validate", "flags.txt", "--format", "yaml"], io);

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

  it("returns a usage error for invalid arguments", async () => {
    const io = createIo(process.cwd());

    const code = await runCli(["validate", "--format", "toml"], io);

    expect(code).toBe(2);
    expect(io.error()).toContain("Usage error: Unsupported format: toml");
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
