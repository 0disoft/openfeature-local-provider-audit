import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";

const flag = {
  type: "boolean",
  defaultVariant: "off",
  variants: { on: true, off: false },
  envVar: "SYNTHETIC_FLAG",
  rules: [{ id: "pilot", when: { attribute: ["tenant"], op: "eq", value: "pilot" }, variant: "on" }]
};
const snapshot = { schemaVersion: 2, flags: { enabled: flag } };
const request = {
  flagKey: "enabled",
  expectedType: "boolean",
  defaultValue: false,
  context: { tenant: "pilot", email: "private@example.test" },
  targetingKey: "private-id"
};

async function exercise(
  args: string[],
  requestInput: unknown = request,
  after: object = { schemaVersion: 2, flags: { enabled: { ...flag, disabledVariant: "off" } } },
  before: object = snapshot
) {
  const directory = await mkdtemp(join(tmpdir(), "local-inspection-test-"));
  const files = {
    "before.json": JSON.stringify(before),
    "after.json": JSON.stringify(after),
    "request.json": typeof requestInput === "string" ? requestInput : JSON.stringify(requestInput)
  };
  let output = "";
  let error = "";
  try {
    for (const [file, value] of Object.entries(files))
      await writeFile(join(directory, file), value);
    const code = await runCli(args, {
      cwd: directory,
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        error += text;
      }
    });
    for (const [file, value] of Object.entries(files))
      expect(await readFile(join(directory, file), "utf8")).toBe(value);
    expect(output + error).not.toContain("private@example.test");
    expect(output + error).not.toContain("private-id");
    return { code, output, error, data: output ? JSON.parse(output) : undefined };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("offline inspection CLI", () => {
  it.each(["evaluate", "explain", "simulate", "compare"])(
    "%s accepts long keys already supported by the snapshot parser",
    async (command) => {
      const flagKey = "a".repeat(264);
      const longSnapshot = { schemaVersion: 2, flags: { [flagKey]: flag } };
      const one = { ...request, flagKey };
      const many = command === "simulate" || command === "compare";
      const args = [command, "before.json"];
      if (command === "compare") args.push("after.json");
      args.push(many ? "--requests" : "--request", "request.json");
      const result = await exercise(args, many ? [one] : one, longSnapshot, longSnapshot);
      expect(result.code).toBe(0);
      expect(result.error).toBe("");
      if (command === "compare") expect(result.data.changedValues).toBe(0);
      else if (many) expect(result.data.errors).toBe(0);
      else expect(result.data.variant).toBe("on");
    }
  );

  it("compares repeated object pairs with key-order equality and array-order differences", async () => {
    const before = {
      schemaVersion: 2,
      flags: {
        config: {
          type: "object",
          defaultVariant: "on",
          variants: { on: { nested: { a: 1, b: null }, items: [1, "2"] } }
        }
      }
    };
    const after = {
      schemaVersion: 2,
      flags: {
        config: {
          type: "object",
          defaultVariant: "on",
          variants: {
            on: { items: [1, "2"], nested: { b: null, a: 1 } },
            changed: { nested: { a: 1, b: null }, items: ["2", 1] }
          },
          rules: [
            {
              id: "changed",
              when: { attribute: ["tier"], op: "eq", value: "changed" },
              variant: "changed"
            }
          ]
        }
      }
    };
    const requests = ["same", "changed", "same", "changed"].map((tier) => ({
      flagKey: "config",
      expectedType: "object",
      defaultValue: null,
      context: { tier }
    }));
    const result = await exercise(
      ["compare", "before.json", "after.json", "--requests", "request.json"],
      requests,
      after,
      before
    );
    expect(result.code).toBe(0);
    expect(result.data).toMatchObject({ total: 4, changedValues: 2, changedDecisions: 2 });
    expect(result.output).not.toContain("nested");
  });

  it.each(["evaluate", "explain"])(
    "%s uses a request file and omits raw values",
    async (command) => {
      const result = await exercise([
        command,
        "before.json",
        "--request",
        "request.json",
        "--json"
      ]);
      expect(result.code).toBe(0);
      expect(result.data).toMatchObject({
        ruleId: "pilot",
        variant: "on",
        reason: "TARGETING_MATCH"
      });
      expect(result.data).not.toHaveProperty("value");
      expect(result.data).not.toHaveProperty("context");
    }
  );

  it("aggregates results and compares both changed values and changed decisions", async () => {
    const requests = [request, request, { ...request, context: { tenant: "other" } }];
    const simulated = await exercise(
      ["simulate", "before.json", "--requests", "request.json"],
      requests
    );
    expect(simulated.code).toBe(0);
    expect(simulated.data).toMatchObject({
      total: 3,
      errors: 0,
      groups: [
        { count: 2, ruleId: "pilot" },
        { count: 1, reason: "STATIC" }
      ]
    });
    expect(simulated.data).not.toHaveProperty("requests");
    const compared = await exercise(
      ["compare", "before.json", "after.json", "--requests", "request.json"],
      requests
    );
    expect(compared.code).toBe(0);
    expect(compared.data).toMatchObject({
      total: 3,
      changedValues: 2,
      changedDecisions: 3,
      after: { errors: 0, groups: [{ reason: "DISABLED", count: 3 }] }
    });
  });

  it("uses explicit overrides for both configurations and reports evaluation errors", async () => {
    const overridden = { ...request, overrides: { env: { SYNTHETIC_FLAG: "false" } } };
    const result = await exercise(
      ["evaluate", "before.json", "--request", "request.json", "--format", "json"],
      overridden
    );
    expect(result.data.reason).toBe("ENV_OVERRIDE");
    const compared = await exercise(
      ["compare", "before.json", "after.json", "--requests", "request.json"],
      [overridden]
    );
    expect(compared.data).toMatchObject({ changedValues: 0, changedDecisions: 1 });
    const missing = await exercise(["evaluate", "before.json", "--request", "request.json"], {
      ...request,
      flagKey: "missing"
    });
    expect(missing.code).toBe(1);
    expect(missing.data.errorCode).toBe("FLAG_NOT_FOUND");
    const errors = await exercise(
      ["simulate", "before.json", "--requests", "request.json"],
      [{ ...request, overrides: { overridesJson: "private-id" } }]
    );
    expect(errors.code).toBe(1);
    expect(errors.data.errors).toBe(1);
  });

  it("compares object values independently of object property order", async () => {
    const config = {
      schemaVersion: 2,
      flags: {
        enabled: { type: "object", defaultVariant: "on", variants: { on: { a: 1, b: [2, 3] } } }
      }
    };
    const result = await exercise(
      ["compare", "before.json", "after.json", "--requests", "request.json"],
      [{ flagKey: "enabled", expectedType: "object", defaultValue: null }],
      {
        schemaVersion: 2,
        flags: {
          enabled: { type: "object", defaultVariant: "on", variants: { on: { b: [2, 3], a: 1 } } }
        }
      },
      config
    );
    expect(result.data).toMatchObject({ changedValues: 0, changedDecisions: 0 });
  });

  it.each([
    ["simulate", "before.json"],
    ["compare", "before.json", "--requests", "request.json"],
    ["evaluate", "before.json", "--requests", "request.json"],
    ["evaluate", "before.json", "--request"],
    ["evaluate", "before.json", "--request", "--json"],
    ["evaluate", "before.json", "--request", "request.json", "--request", "request.json"],
    ["evaluate", "before.json", "--request", "request.json", "--format", "toml"]
  ])("rejects usage without reading private input: %j", async (...args) => {
    expect((await exercise(args)).code).toBe(2);
  });

  it.each([
    "private-id not JSON",
    [],
    Array(10001).fill(request),
    { ...request, unknown: "private-id" },
    { ...request, flagKey: "" },
    { ...request, expectedType: "bad" },
    { ...request, defaultValue: "bad" },
    { ...request, context: [] },
    { ...request, targetingKey: 2 },
    { ...request, overrides: "private-id" },
    { ...request, overrides: { env: { FLAG: 2 } } },
    { ...request, overrides: { overridesJson: 2 } },
    Array.from({ length: 33 }).reduce<object>((child) => ({ child }), request)
  ])("fails invalid input without echoing it: %j", async (input) => {
    const result = await exercise(["evaluate", "before.json", "--request", "request.json"], input);
    expect(result.code).toBe(1);
    expect(result.output).toBe("");
    expect(result.error).toContain("Inputs and values are omitted");
  });

  it("bounds file bytes before parsing", async () => {
    const result = await exercise(
      ["evaluate", "before.json", "--request", "request.json"],
      " ".repeat(10 * 1024 * 1024 + 1)
    );
    expect(result.code).toBe(1);
    expect(result.output).toBe("");
  });

  it("prints inspection help", async () => {
    let output = "";
    expect(
      await runCli(["simulate", "--help"], {
        cwd: process.cwd(),
        stdout: (text) => {
          output += text;
        },
        stderr: () => {}
      })
    ).toBe(0);
    expect(output).toContain("compare <before> <after>");
  });
});
