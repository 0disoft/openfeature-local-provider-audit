import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/run.js";

afterEach(() => vi.restoreAllMocks());

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
    return {
      code,
      output,
      error,
      data: output && !args.includes("markdown") ? JSON.parse(output) : undefined
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("offline inspection CLI", () => {
  it("renders redacted review tables with the same counts and policy exit status as JSON", async () => {
    const args = [
      "compare",
      "before.json",
      "after.json",
      "--requests",
      "request.json",
      "--max-changed-values-percent",
      "0"
    ];
    const requests = [request, { ...request, context: { tenant: "other" } }];
    const json = await exercise(args, requests);
    const markdown = await exercise([...args, "--output", "markdown"], requests);
    expect(markdown.code).toBe(json.code);
    expect(markdown.code).toBe(3);
    expect(markdown.output).toContain("Snapshot validation: passed for both inputs.");
    expect(markdown.output).toContain("Change policy: FAILED.");
    expect(markdown.output).toContain("| Changed values | 1 / 2 |");
    expect(markdown.output).toContain("| Changed decisions | 2 / 2 |");
    expect(markdown.output).toContain("| <code>enabled</code> | 2 | 1 | 2 |");
    expect(markdown.output).toContain("TARGETING&#95;MATCH");
    expect(markdown.output).toContain("DISABLED");
    expect(markdown.output).not.toContain("tenant");
    expect(markdown.error).toBe("");
    expect((await exercise([...args, "--output", "json"], requests)).output).toBe(json.output);
  });

  it("retains error precedence and emits no partial Markdown for malformed later requests", async () => {
    const args = [
      "compare",
      "before.json",
      "after.json",
      "--requests",
      "request.json",
      "--output",
      "markdown",
      "--max-changed-values-percent",
      "0",
      "--diagnostics"
    ];
    const errors = await exercise(args, [request, { ...request, flagKey: "missing" }]);
    expect(errors.code).toBe(1);
    expect(errors.output).toContain("Evaluations: errors found.");
    expect(errors.output).toContain("Change policy: FAILED.");
    const malformed = await exercise(args, [request, { ...request, expectedType: "invalid" }]);
    expect(malformed.code).toBe(1);
    expect(malformed.output).toBe("");
    expect(malformed.error).toContain('"requestIndex":1');
  });

  it.each([
    ["--output", "html"],
    ["--output"],
    ["--output", "markdown", "--json"],
    ["--json", "--output", "markdown"],
    ["--output", "markdown", "--output", "json"]
  ])("rejects invalid or conflicting comparison presentation: %j", async (...options) => {
    const result = await exercise([
      "compare",
      "before.json",
      "after.json",
      "--requests",
      "request.json",
      ...options
    ]);
    expect(result.code).toBe(2);
    expect(result.output).toBe("");
  });

  it.each(["evaluate", "simulate"])("does not silently change %s output", async (command) => {
    const result = await exercise([
      command,
      "before.json",
      command === "evaluate" ? "--request" : "--requests",
      "request.json",
      "--output",
      "markdown"
    ]);
    expect(result.code).toBe(2);
    expect(result.output).toBe("");
  });

  it.each(["simulate", "compare"])(
    "emits no partial %s report when a later request is malformed after an evaluation error",
    async (command) => {
      const args = [command, "before.json"];
      if (command === "compare") args.push("after.json");
      args.push("--requests", "request.json", "--diagnostics");
      const result = await exercise(args, [
        { ...request, overrides: { env: { SYNTHETIC_FLAG: "invalid" } } },
        { ...request, context: { tenant: "other" } },
        { ...request, expectedType: "invalid" }
      ]);
      expect(result).toMatchObject({ code: 1, output: "" });
      expect(result.error).toContain('"code":"REQUEST_SCHEMA"');
      expect(result.error).toContain('"requestIndex":2');
    }
  );

  it.each(["root", "nested"])(
    "rejects a %s array exceeding the request node budget before copying values",
    async (location) => {
      const length = location === "root" ? 100_000 : 99_995;
      const input =
        location === "root"
          ? Array(length).fill(0)
          : {
              flagKey: "enabled",
              expectedType: "boolean",
              defaultValue: false,
              context: { payload: Array(length).fill(0) }
            };
      const values = Object.values;
      let copied = 0;
      vi.spyOn(Object, "values").mockImplementation((value) => {
        const result = values(value);
        if (Array.isArray(value) && value.length === length) copied += result.length;
        return result;
      });
      const result = await exercise(
        [
          location === "root" ? "simulate" : "explain",
          "before.json",
          location === "root" ? "--requests" : "--request",
          "request.json",
          "--diagnostics"
        ],
        input
      );
      expect(result).toMatchObject({ code: 1, output: "" });
      expect(result.error).toContain('"code":"REQUEST_LIMIT"');
      expect(copied).toBe(0);
    }
  );

  it("preserves the exact request node budget including containers and siblings", async () => {
    for (const [length, code] of [
      [99_994, 0],
      [99_995, 1]
    ] as const) {
      const result = await exercise(
        ["evaluate", "before.json", "--request", "request.json", "--diagnostics"],
        {
          flagKey: "enabled",
          expectedType: "boolean",
          defaultValue: false,
          context: { payload: Array(length).fill(0) }
        }
      );
      expect(result.code).toBe(code);
      if (code === 0) expect(result.data.reason).toBe("STATIC");
      else expect(result.error).toContain('"code":"REQUEST_LIMIT"');
    }
  });

  it.each([
    ["33.3333", 3],
    ["33.3334", 0]
  ] as const)(
    "checks fractional change rates without rounding to the threshold %s",
    async (percent, code) => {
      const result = await exercise(
        [
          "compare",
          "before.json",
          "after.json",
          "--requests",
          "request.json",
          "--max-changed-values-percent",
          percent
        ],
        [
          request,
          { ...request, context: { tenant: "other" } },
          { ...request, context: { tenant: "other" } }
        ]
      );
      expect(result.code).toBe(code);
      expect(result.data.changedValues).toBe(1);
    }
  );

  it("allows unchanged comparisons at zero and reports both failed limits", async () => {
    const args = [
      "compare",
      "before.json",
      "after.json",
      "--requests",
      "request.json",
      "--max-changed-values-percent",
      "0",
      "--max-changed-decisions-percent",
      "0"
    ];
    const same = await exercise(args, [request], snapshot, snapshot);
    expect(same.code).toBe(0);
    expect(same.data.policy.violations).toEqual([]);
    const changed = await exercise(args, [request]);
    expect(changed.code).toBe(3);
    expect(changed.data.policy.violations).toEqual([
      "CHANGED_VALUES_LIMIT",
      "CHANGED_DECISIONS_LIMIT"
    ]);
    const exact = await exercise(
      [...args.slice(0, 5), "--max-changed-values-percent", "100.0000"],
      [request]
    );
    expect(exact.code).toBe(0);
  });

  it.each([
    ["before.json", "not JSON", "REQUEST_INPUT"],
    ["before.json", [], "REQUEST_LIMIT"],
    ["missing.json", [request], "SNAPSHOT_INPUT"]
  ])("diagnoses input failures without echoing inputs: case %#", async (file, input, code) => {
    const result = await exercise(
      ["simulate", file as string, "--requests", "request.json", "--diagnostics"],
      input
    );
    expect(result.code).toBe(1);
    expect(result.error).toContain(`"code":"${code}"`);
    expect(result.error).not.toContain("requestIndex");
  });

  it.each([
    ["--max-changed-values-percent", "50", 0],
    ["--max-changed-values-percent", "49.9", 3],
    ["--max-changed-decisions-percent", "100", 0],
    ["--max-changed-decisions-percent", "99", 3]
  ] as const)("enforces comparison limit %s=%s", async (option, limit, code) => {
    const result = await exercise(
      ["compare", "before.json", "after.json", "--requests", "request.json", option, limit],
      [request, { ...request, context: { tenant: "other" } }]
    );
    expect(result.code).toBe(code);
    expect(result.data).toMatchObject({
      total: 2,
      changedValues: 1,
      changedDecisions: 2,
      policy: { passed: code === 0 }
    });
    expect(result.output).not.toContain("tenant");
  });

  it("keeps evaluation errors ahead of comparison-policy failure", async () => {
    const result = await exercise(
      [
        "compare",
        "before.json",
        "after.json",
        "--requests",
        "request.json",
        "--max-changed-decisions-percent",
        "0"
      ],
      [request, { ...request, flagKey: "missing" }]
    );
    expect(result.code).toBe(1);
    expect(result.data.policy.passed).toBe(false);
  });

  it("reports safe request indexes only when diagnostics are requested", async () => {
    const result = await exercise(
      ["simulate", "before.json", "--requests", "request.json", "--diagnostics"],
      [request, { ...request, expectedType: "private@example.test" }]
    );
    expect(result.code).toBe(1);
    expect(result.output).toBe("");
    expect(result.error).toContain('"code":"REQUEST_SCHEMA"');
    expect(result.error).toContain('"requestIndex":1');
    expect(result.error).not.toContain("expectedType");
    const single = await exercise(
      ["evaluate", "before.json", "--request", "request.json", "--diagnostics"],
      { ...request, expectedType: "private@example.test" }
    );
    expect(single.error).toContain('"code":"REQUEST_SCHEMA"');
    expect(single.error).not.toContain("requestIndex");
    const ordinary = await exercise(["evaluate", "before.json", "--request", "request.json"], {
      ...request,
      expectedType: "private@example.test"
    });
    expect(ordinary.error).not.toContain("REQUEST_SCHEMA");
  });

  it.each(["-1", "101", "NaN", "Infinity", "0x10", "1e2", "0.00001"])(
    "rejects invalid comparison percentages: %s",
    async (value) => {
      const result = await exercise(
        [
          "compare",
          "before.json",
          "after.json",
          "--requests",
          "request.json",
          "--max-changed-values-percent",
          value
        ],
        [request]
      );
      expect(result.code).toBe(2);
      expect(result.output).toBe("");
    }
  );

  it("rejects comparison limits on other commands and duplicate limits", async () => {
    for (const args of [
      [
        "simulate",
        "before.json",
        "--requests",
        "request.json",
        "--max-changed-values-percent",
        "0"
      ],
      [
        "compare",
        "before.json",
        "after.json",
        "--requests",
        "request.json",
        "--max-changed-values-percent",
        "0",
        "--max-changed-values-percent",
        "100"
      ]
    ])
      expect((await exercise(args, [request])).code).toBe(2);
  });

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
    expect(compared.data).not.toHaveProperty("policy");
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
