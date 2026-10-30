interface DecisionGroup {
  readonly flagKey: string;
  readonly reason: string;
  readonly variant?: string;
  readonly ruleId?: string;
  readonly errorCode?: string;
  readonly count: number;
}

interface ComparisonSummary {
  readonly snapshotHash: string;
  readonly errors: number;
  readonly groups: readonly DecisionGroup[];
}

export interface FlagChanges {
  readonly flagKey: string;
  requests: number;
  changedValues: number;
  changedDecisions: number;
}

export interface ComparisonReport {
  readonly total: number;
  readonly changedValues: number;
  readonly changedDecisions: number;
  readonly before: ComparisonSummary;
  readonly after: ComparisonSummary;
  readonly policy?: {
    readonly passed: boolean;
    readonly maxChangedValuesPercent?: number;
    readonly maxChangedDecisionsPercent?: number;
    readonly violations: readonly string[];
  };
}

const MAX_TABLE_ROWS = 100;
const MAX_CELL_CHARACTERS = 160;

export function comparisonMarkdown(
  report: ComparisonReport,
  flags: readonly FlagChanges[]
): string {
  const { before, after, policy } = report;
  const lines = [
    "# Flag configuration comparison",
    "",
    "Snapshot validation: passed for both inputs.",
    `Evaluations: ${before.errors + after.errors === 0 ? "passed" : "errors found"}.`,
    `Change policy: ${policy === undefined ? "not configured" : policy.passed ? "passed" : "FAILED"}.`,
    "",
    "| Sample summary | Count |",
    "| --- | ---: |",
    `| Requests per snapshot | ${report.total} |`,
    `| Changed values | ${report.changedValues} / ${report.total} |`,
    `| Changed decisions | ${report.changedDecisions} / ${report.total} |`,
    `| Evaluation errors before / after | ${before.errors} / ${after.errors} |`,
    "",
    `Before snapshot: ${cell(before.snapshotHash)}`,
    `After snapshot: ${cell(after.snapshotHash)}`,
    ""
  ];
  if (policy !== undefined) {
    if (policy.maxChangedValuesPercent !== undefined)
      lines.push(`Maximum changed values: ${policy.maxChangedValuesPercent}%.`);
    if (policy.maxChangedDecisionsPercent !== undefined)
      lines.push(`Maximum changed decisions: ${policy.maxChangedDecisionsPercent}%.`);
    if (policy.violations.length)
      lines.push(`Violations: ${policy.violations.map(cell).join(", ")}.`);
    lines.push("");
  }
  table(
    lines,
    "Sampled flags",
    ["Flag", "Requests", "Changed values", "Changed decisions"],
    flags.map((flag) => [flag.flagKey, flag.requests, flag.changedValues, flag.changedDecisions])
  );
  for (const [title, summary] of [
    ["Before decisions", before],
    ["After decisions", after]
  ] as const)
    table(
      lines,
      title,
      ["Flag", "Reason", "Variant", "Rule", "Error", "Count"],
      summary.groups.map((group) => [
        group.flagKey,
        group.reason,
        group.variant ?? "—",
        group.ruleId ?? "—",
        group.errorCode ?? "—",
        group.count
      ])
    );
  lines.push(
    "Counts describe only the supplied request corpus, not production traffic or every changed configuration rule.",
    "Values, contexts, subject identifiers and condition operands are omitted. Flag, variant and rule names may still be sensitive.",
    `Tables show at most ${MAX_TABLE_ROWS} rows each; cells longer than ${MAX_CELL_CHARACTERS} characters are truncated. Use JSON for complete aggregate details.`,
    ""
  );
  return lines.join("\n");
}

function table(
  lines: string[],
  title: string,
  headings: readonly string[],
  rows: readonly (readonly (string | number)[])[]
): void {
  lines.push(
    `## ${title}`,
    "",
    `| ${headings.join(" | ")} |`,
    `| ${headings.map(() => "---").join(" | ")} |`
  );
  for (const row of rows.slice(0, MAX_TABLE_ROWS)) lines.push(`| ${row.map(cell).join(" | ")} |`);
  if (rows.length > MAX_TABLE_ROWS)
    lines.push(
      "",
      `${rows.length - MAX_TABLE_ROWS} additional rows omitted; aggregate counts include them.`
    );
  lines.push("");
}

function cell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const text = String(value);
  const bounded =
    text.length > MAX_CELL_CHARACTERS ? `${text.slice(0, MAX_CELL_CHARACTERS)}…` : text;
  const escaped = bounded
    .replace(
      /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    )
    .replace(/[&<>"'`|\\[\]()!*_@#~:]/g, (character) => `&#${character.charCodeAt(0)};`);
  return `<code>${escaped}</code>`;
}
