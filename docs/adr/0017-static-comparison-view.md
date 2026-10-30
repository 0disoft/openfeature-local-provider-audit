# ADR 0017: offline static comparison view

Status: Accepted by the user's 2026-10-30 static-view work request.
Owner: 0disoft

## Decision

Extend the existing local inspection CLI with `compare --output html`. It renders
the same redacted aggregate comparison into one self-contained HTML document. The
application redirects stdout to a file and opens it locally; no web server, editor,
live audit reader, credentials, network calls, client scripts or hosted UI is added.

The source of truth remains `docs/library/local-inspection.md`. HTML and Markdown
share the comparison result, sampled-flag counts, first-encounter ordering and exit
codes. Displayed labels and tables are bounded; aggregate totals remain complete.
The static view includes accessible tables and meters, responsive layout and print
styles. No raw context, evaluated value or condition operand is embedded, including
in hidden data, attributes or scripts. User-controlled identifiers are escaped as
text; restrictive CSP blocks scripts, network resources, forms and base changes.

This is an additive CLI feature staged as 2.2.0. Provider evaluation, runtime
support, JSON output, snapshot/audit wire formats and public function exports do not
change. It does not estimate production impact or turn validation into approval.
The deferred hosted control-plane/dashboard scope stays excluded.

## Verification

Check JSON/Markdown compatibility, HTML policy and error exit precedence, malformed
later input, identifier injection, label/row limits, and real packed CLI execution.
An opt-in browser smoke opens the local file at desktop and narrow widths, checks
tables/meters and absence of scripts/network requests, and captures a screenshot.
It does not add hosted CI work or a browser dependency for package consumers.
