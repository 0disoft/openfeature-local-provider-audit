import { describe, expect, it } from "vitest";
import { comparisonMarkdown } from "../../src/cli/comparison-markdown.js";

describe("comparison review presentation", () => {
  it("bounds every table and identifier while retaining complete aggregate counts", () => {
    const groups = Array.from({ length: 101 }, (_, index) => ({
      flagKey: `flag-${index}`,
      reason: "STATIC",
      count: 1
    }));
    const output = comparisonMarkdown(
      {
        total: 101,
        changedValues: 101,
        changedDecisions: 101,
        before: { snapshotHash: "a".repeat(64), errors: 0, groups },
        after: { snapshotHash: "b".repeat(64), errors: 0, groups }
      },
      groups.map((group) => ({
        flagKey: group.flagKey,
        requests: 1,
        changedValues: 1,
        changedDecisions: 1
      }))
    );
    expect(output).toContain("| Changed values | 101 / 101 |");
    expect(output).toContain("| <code>flag-99</code> | 1 | 1 | 1 |");
    expect(output).not.toContain("flag-100");
    expect(output.match(/1 additional rows omitted/g)).toHaveLength(3);
    expect(output).toContain("Change policy: not configured.");
  });

  it("escapes markup, mentions, table delimiters and control characters in every identifier", () => {
    const hostile =
      "<img src=x onerror=alert(1)>|[click](https://example.test)\n```@reviewers#1\u001b\u202e";
    const group = {
      flagKey: hostile,
      reason: "STATIC",
      variant: hostile,
      ruleId: hostile,
      errorCode: hostile,
      count: 1
    };
    const output = comparisonMarkdown(
      {
        total: 1,
        changedValues: 0,
        changedDecisions: 0,
        before: { snapshotHash: "a".repeat(64), errors: 1, groups: [group] },
        after: { snapshotHash: "b".repeat(64), errors: 1, groups: [group] },
        policy: { passed: true, maxChangedDecisionsPercent: 100, violations: [] }
      },
      [{ flagKey: hostile, requests: 1, changedValues: 0, changedDecisions: 0 }]
    );
    for (const raw of ["<img", "|[click]", "```", "@reviewers", "\u001b", "\u202e"])
      expect(output).not.toContain(raw);
    expect(output).toContain("reviewers&#35;1");
    expect(output).toContain("&#60;img");
    expect(output).toContain("&#124;");
    expect(output).toContain("u001b");
    expect(output).toContain("Change policy: passed.");
    expect(output).toContain("Maximum changed decisions: 100%.");
  });

  it("truncates long fields and does not serialize undeclared payloads", () => {
    const groups = [
      {
        flagKey: "x".repeat(161),
        reason: "STATIC",
        count: 1,
        value: "secret-value",
        context: { email: "secret-email" }
      }
    ];
    const summary = { snapshotHash: "a".repeat(64), errors: 0, groups };
    const output = comparisonMarkdown(
      { total: 1, changedValues: 0, changedDecisions: 0, before: summary, after: summary },
      []
    );
    expect(output).toContain(`${"x".repeat(160)}…`);
    expect(output).not.toContain("x".repeat(161));
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("secret-email");
  });
});
