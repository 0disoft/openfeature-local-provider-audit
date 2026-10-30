import { describe, expect, it } from "vitest";
import { comparisonHtml } from "../../src/cli/comparison-html.js";

const summary = {
  snapshotHash: "a".repeat(64),
  errors: 0,
  groups: [{ flagKey: "checkout", reason: "STATIC", count: 2 }]
};
const report = { total: 2, changedValues: 1, changedDecisions: 2, before: summary, after: summary };
const flags = [{ flagKey: "checkout", requests: 2, changedValues: 1, changedDecisions: 2 }];

describe("static HTML comparison view", () => {
  it("shows accurate counts, accessible meters, identities and explicit unconfigured policy", () => {
    const html = comparisonHtml(report, flags);
    expect(html).toContain("50.0");
    expect(html).toContain("100.0");
    expect(html).toContain('max="2" value="1"');
    expect(html).toContain('aria-label="Changed values"');
    expect(html).toContain("Not configured");
    expect(html).toContain("Review ready");
    expect(html).toContain("Before decisions");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain('scope="col"');
    expect(html).not.toMatch(/<(?:script|img|iframe|form|link)\b/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("style-src 'unsafe-inline'");
    expect(html).toContain("@media print");
    expect(comparisonHtml({ ...report, changedValues: 0 }, flags)).toContain("0.0");
  });

  it("escapes identifiers including HTML events and keeps undeclared payloads out of the document", () => {
    const hostile =
      '</code><img src="https://attacker.invalid/x" onerror="alert(1)"><script>secret()</script>\n\u202e';
    const group = {
      flagKey: hostile,
      reason: "STATIC",
      variant: hostile,
      ruleId: hostile,
      errorCode: hostile,
      count: 2,
      value: "private-value",
      context: { email: "private-email" }
    };
    const input = { ...summary, groups: [group] };
    const html = comparisonHtml({ ...report, before: input, after: input }, [
      { flagKey: hostile, requests: 2, changedValues: 1, changedDecisions: 2 }
    ]);
    expect(html).not.toMatch(/<(?:script|img)\b/i);
    expect(html).not.toContain("\u202e");
    expect(html).toContain("u202e");
    expect(html).toContain("&#60;/code&#62;");
    expect(html).not.toContain("private-value");
    expect(html).not.toContain("private-email");
  });

  it("bounds all tables and labels while retaining totals and failed policy/error status", () => {
    const groups = Array.from({ length: 101 }, (_, index) => ({
      flagKey: `flag-${index}`,
      reason: "STATIC",
      count: 1
    }));
    const html = comparisonHtml(
      {
        total: 101,
        changedValues: 101,
        changedDecisions: 101,
        before: { ...summary, errors: 1, groups },
        after: { ...summary, groups },
        policy: {
          passed: false,
          maxChangedValuesPercent: 0,
          maxChangedDecisionsPercent: 0,
          violations: ["CHANGED_VALUES_LIMIT"]
        }
      },
      groups.map((group) => ({
        flagKey: group.flagKey,
        requests: 1,
        changedValues: 1,
        changedDecisions: 1
      }))
    );
    expect(html).toContain("101 / 101");
    expect(html).toContain("Evaluation errors found");
    expect(html).toContain("CHANGED_VALUES_LIMIT");
    expect(html).toContain("Changed decisions ≤ 0%");
    expect(html).not.toContain("flag-100");
    expect(html.match(/1 additional rows omitted/g)).toHaveLength(3);
    const bounded = comparisonHtml({ ...report, policy: { passed: true, violations: [] } }, [
      { flagKey: "x".repeat(161), requests: 2, changedValues: 1, changedDecisions: 2 }
    ]);
    expect(bounded).toContain(`${"x".repeat(160)}…`);
    expect(bounded).not.toContain("x".repeat(161));
  });
});
