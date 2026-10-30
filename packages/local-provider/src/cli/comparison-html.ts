import type { ComparisonReport, FlagChanges } from "./comparison-markdown.js";

const MAX_ROWS = 100;
const MAX_LABEL_LENGTH = 160;

export function comparisonHtml(report: ComparisonReport, flags: readonly FlagChanges[]): string {
  const { before, after, policy, total } = report;
  const errors = before.errors + after.errors;
  const policyLabel = policy === undefined ? "Not configured" : policy.passed ? "Passed" : "Failed";
  const status = errors
    ? "Evaluation errors found"
    : policy?.passed === false
      ? "Change limit exceeded"
      : "Review ready";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Flag change review · OpenFeature Local Provider</title>
<style>${STYLE}</style></head><body>
<header><div class="brand">OPENFEATURE <span>/ LOCAL PROVIDER</span></div><span class="offline">Offline report</span></header>
<main><section class="intro"><p class="eyebrow">CONFIGURATION REVIEW</p><h1>Flag change review</h1>
<p class="lead">Two snapshots. The same ${total} synthetic or caller-supplied requests.<br>See the observed changes before applying your configuration.</p>
<p class="status ${errors || policy?.passed === false ? "attention" : "ready"}">${status}</p></section>
<section class="cards" aria-label="Sample summary">
${card("Changed values", report.changedValues, total, "Requests whose returned value changed")}
${card("Changed decisions", report.changedDecisions, total, "Reason, variant, rule, bucket, source, error or schedule changed")}
<article class="card"><h2>Evaluation errors</h2><div class="number">${errors}<span>across both snapshots</span></div><p>Before ${before.errors} / After ${after.errors}</p></article></section>
<section class="checks" aria-label="Validation and policy"><p>Snapshot validation <strong>Passed</strong></p>
<p>Evaluations <strong>${errors ? "Errors found" : "Passed"}</strong></p><p>Change policy <strong>${policyLabel}</strong></p></section>
${
  policy === undefined
    ? ""
    : `<aside class="policy"><h2>Configured change limits</h2><p>${[
        policy.maxChangedValuesPercent === undefined
          ? ""
          : `Changed values ≤ ${policy.maxChangedValuesPercent}%`,
        policy.maxChangedDecisionsPercent === undefined
          ? ""
          : `Changed decisions ≤ ${policy.maxChangedDecisionsPercent}%`
      ]
        .filter(Boolean)
        .join(
          " · "
        )}</p>${policy.violations.length ? `<p>Violations: ${policy.violations.map(label).join(", ")}</p>` : ""}</aside>`
}
<section class="panel"><div class="section-heading"><div><p class="eyebrow">SAMPLED IMPACT</p><h2>Changes by flag</h2></div><p>${flags.length} sampled flags · ${total} requests</p></div>
<p class="hint">Bars show changed values within each flag's supplied requests, not rollout eligibility or production traffic. Tables scroll horizontally on narrow screens.</p>
<div class="table-scroll"><table><caption class="sr-only">Per-flag changes for the supplied corpus</caption><thead><tr><th scope="col">Flag</th><th scope="col">Requests</th><th scope="col">Changed values</th><th scope="col">Changed decisions</th></tr></thead><tbody>
${flags
  .slice(0, MAX_ROWS)
  .map(
    (flag) =>
      `<tr><th scope="row">${label(flag.flagKey)}</th><td>${flag.requests}</td><td><div class="impact"><meter min="0" max="${flag.requests}" value="${flag.changedValues}" aria-label="Changed values">${flag.changedValues} / ${flag.requests}</meter><span>${flag.changedValues} / ${flag.requests}</span></div></td><td>${flag.changedDecisions} / ${flag.requests}</td></tr>`
  )
  .join("\n")}
</tbody></table></div>${omitted(flags.length)}</section>
<section class="decisions" aria-label="Decision details">${decisions("Before decisions", before)}${decisions("After decisions", after)}</section>
<section class="panel provenance"><h2>Snapshot identity</h2><dl><dt>Before</dt><dd>${label(before.snapshotHash)}</dd><dt>After</dt><dd>${label(after.snapshotHash)}</dd></dl>
<p>Content hashes identify these inputs; they do not authenticate the configuration author.</p></section>
<footer><h2>Read this report in context</h2><p>Counts describe only the supplied corpus, including evaluation errors. Unexercised conditions and unsampled flags are not measured. This is not a structural configuration diff or deployment approval.</p>
<p>Values, contexts, subject identifiers, condition operands and file paths are omitted. Flag, variant and rule names and small-cohort counts may still be sensitive. Share only with authorized reviewers.</p>
<p>Each table displays up to ${MAX_ROWS} rows in first-encounter order. Labels longer than ${MAX_LABEL_LENGTH} UTF-16 code units are truncated; totals include all requests. Use JSON for complete aggregate details.</p>
<p class="footnote">Generated locally by OpenFeature Local Provider · No scripts, external assets, telemetry or live connection</p></footer></main></body></html>\n`;
}

function card(title: string, changed: number, total: number, description: string): string {
  return `<article class="card"><h2>${title}</h2><div class="number">${((changed * 100) / total).toFixed(1)}<span>% of sample</span></div><p><strong>${changed} / ${total}</strong> · ${description}</p></article>`;
}

function decisions(title: string, summary: ComparisonReport["before"]): string {
  return `<details class="panel" open><summary>${title}<span>${summary.errors} errors</span></summary>
<div class="table-scroll"><table><caption class="sr-only">${title} grouped outcomes</caption><thead><tr>${["Flag", "Reason", "Variant", "Rule", "Error", "Count"].map((heading) => `<th scope="col">${heading}</th>`).join("")}</tr></thead><tbody>
${summary.groups
  .slice(0, MAX_ROWS)
  .map(
    (group) =>
      `<tr>${[group.flagKey, group.reason, group.variant ?? "—", group.ruleId ?? "—", group.errorCode ?? "—"].map((value) => `<td>${label(value)}</td>`).join("")}<td>${group.count}</td></tr>`
  )
  .join("\n")}
</tbody></table></div>${omitted(summary.groups.length)}</details>`;
}

function omitted(count: number): string {
  return count > MAX_ROWS
    ? `<p class="hint">${count - MAX_ROWS} additional rows omitted. Aggregate counts include them.</p>`
    : "";
}

function label(value: string): string {
  const bounded = value.length > MAX_LABEL_LENGTH ? `${value.slice(0, MAX_LABEL_LENGTH)}…` : value;
  return `<code>${bounded.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)}</code>`;
}

const STYLE = `
:root{color-scheme:light;--ink:#172b38;--muted:#50616a;--line:#dce3df;--accent:#236546;--paper:#f5f7f3}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px max(24px,calc((100vw - 1240px)/2));border-bottom:1px solid var(--line);background:#fff}
.brand{font-size:12px;font-weight:800;letter-spacing:.08em}.brand span{color:var(--muted);font-weight:500}.offline{border:1px solid var(--line);border-radius:30px;padding:4px 12px;font-size:12px;white-space:nowrap}
main{max-width:1288px;margin:auto;padding:42px 24px 28px}.intro{position:relative;margin-bottom:30px}.eyebrow{font-size:11px;letter-spacing:.14em;font-weight:750;color:var(--accent);margin:0 0 8px}h1{font-size:clamp(32px,4vw,48px);line-height:1.15;letter-spacing:-.04em;margin:0 0 16px}h2{font-size:17px;margin:0}.lead{color:var(--muted);max-width:720px}.status{display:inline-block;border-radius:5px;padding:5px 12px;font-weight:650}.ready{background:#e0eee2;color:#20553b}.attention{background:#f9e3d9;color:#8a3520}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card,.panel{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px}.card h2{font-size:13px;color:var(--muted);font-weight:650}.number{font-size:48px;line-height:1.1;letter-spacing:-.04em;margin:18px 0 12px;font-weight:650}.number span{display:block;font-size:12px;font-weight:450;letter-spacing:0;margin-top:7px;color:var(--muted)}.card p{font-size:12px;color:var(--muted);margin:0;min-height:38px}.card strong{color:var(--ink)}
.checks{display:flex;gap:24px;flex-wrap:wrap;margin:20px 0}.checks p{font-size:12px;margin:0;color:var(--muted)}.checks strong{display:inline-block;margin-left:8px;color:var(--ink)}.policy{padding:16px 20px;background:#eaf0e8;border-left:3px solid var(--accent);margin:0 0 20px;border-radius:3px}.policy h2{font-size:13px}.policy p{font-size:12px;margin:4px 0 0}
.panel{margin-bottom:20px;min-width:0}.section-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.section-heading p:last-child,.hint{font-size:12px;color:var(--muted)}.table-scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;min-width:520px;width:100%;font-size:12px;text-align:left}caption{text-align:left}thead{background:#f5f7f3}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}thead th{font-size:11px;font-weight:650;white-space:nowrap}tbody th{font-weight:450}code{font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;white-space:pre-wrap}.impact{display:flex;align-items:center;gap:10px;white-space:nowrap}meter{width:90px;height:12px;accent-color:var(--accent)}meter::-webkit-meter-bar{background:#e2ebe3;border:0}meter::-webkit-meter-optimum-value{background:var(--accent)}
.decisions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.decisions .panel{padding:18px}summary{cursor:pointer;font-weight:650;margin-bottom:16px}summary span{float:right;font-size:11px;font-weight:450;color:var(--muted)}.provenance dl{display:grid;grid-template-columns:64px minmax(0,1fr);gap:6px;margin:16px 0}.provenance dt{font-size:12px;color:var(--muted)}.provenance dd{margin:0}.provenance p{font-size:12px;color:var(--muted)}footer{max-width:970px;color:var(--muted);font-size:12px}footer h2{font-size:13px;color:var(--ink)}.footnote{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);font-size:11px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(min-width:1000px){.intro .status{position:absolute;right:0;top:12px}}@media(max-width:760px){main{padding:28px 16px}header{padding:16px}.brand span{display:block}.cards,.decisions{grid-template-columns:1fr}.number{font-size:40px}.card{padding:20px}.card p{min-height:0}.panel{padding:18px}.section-heading{align-items:flex-start;flex-direction:column;gap:0}.checks{gap:10px 20px}}
@media print{header{padding:12px 0}main{padding:20px 0}.cards{grid-template-columns:repeat(3,minmax(0,1fr))}.decisions{grid-template-columns:1fr}.panel,.card{break-inside:avoid;box-shadow:none}body{background:#fff}summary{list-style:none}.table-scroll{overflow:visible}table{min-width:0}.status{position:static!important}}
`;
