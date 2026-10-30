# Review a flag change without a flag server

This recipe uses the CLI's local comparison engine to give developers and operations
reviewers a readable change summary. It does not start a server, load production
user data, write a snapshot, or publish configuration. The Markdown option requires
CLI 2.1.0 or a built checkout; the current published 2.0.0 does not contain it.

## Try the complete local example

From this checkout with the declared Node/pnpm toolchain installed:

```sh
corepack pnpm run build
node packages/local-provider/bin/openfeature-local-provider.js compare \
  examples/flag-review/before.json examples/flag-review/after.json \
  --requests examples/flag-review/requests.json --output markdown \
  --max-changed-values-percent 50
```

The fixture adds a pilot rule. Four synthetic requests produce two changed values
and two changed decisions; the inclusive 50% limit passes. A limit of 49 exits 3,
and an evaluation failure exits 1 even if the policy also fails. JSON is still the
default. Redirect stdout to a Markdown file for a normal document preview.

For a standalone visual report from CLI 2.2.0 or this checkout, change the output:

```sh
node packages/local-provider/bin/openfeature-local-provider.js compare \
  examples/flag-review/before.json examples/flag-review/after.json \
  --requests examples/flag-review/requests.json --output html \
  --max-changed-values-percent 50 > review.html
```

Open that local file in a browser. It includes summary cards, per-flag change meters,
expandable decision tables and print styles, with no scripts or external resources.
It needs no installation of a web UI, server startup or configuration write access.

The report shows schema validation, content hashes, sample size, per-flag changes,
selected rule counts and policy status. It omits configuration values, request
contexts and condition operands. Identifiers and small-group counts still need
appropriate access control. See [the report contract](../library/local-inspection.md).

## Add a PR check to a consumer repository

The inactive template is
[.github/examples/flag-review.yml](../../.github/examples/flag-review.yml).
It is outside `.github/workflows`, so this repository gains no recurring runner job.
Before enabling it:

1. Publish or obtain the reviewed CLI 2.1 package. The template deliberately requires
   `@^2.1.0` and will not fall back to the older 2.0 CLI. This local change does not
   publish it or activate consumer automation.
2. Put the existing configuration at `flags.json` and the maintained synthetic corpus
   at `flag-review/requests.json` in the consumer's base branch. Adapt the fixed paths
   and PR path filters for your repository. Both snapshots must exist; an initial
   addition or deletion needs a deliberate comparison baseline.
3. Copy the template into that consumer's `.github/workflows/flag-review.yml` and
   review the policy limit. Fifty percent is an example, not a recommended production
   threshold or authorization to deploy a change. Use your own representative corpus.
4. Open the check's run summary from the PR Checks view to read the tables. The
   downloadable report is retained for three days. Existing repository access rules
   apply; a public consumer repository's report must contain public-safe identifiers.

The workflow checks out immutable base/head SHAs into separate read-only inputs.
It compares candidate settings against the **base branch's** requests, so the PR cannot
reduce the checked cohort by changing its own request file. Corpus-only PRs therefore
review their fixture edits separately; the new corpus takes effect after merge.
Configuration conditions that no request exercises remain unmeasured.

Only the installed provider CLI runs. No candidate package scripts, application code,
Git hooks supplied by the PR, shell expressions from PR titles, or third-party PR
actions execute. Tool installation is outside both checkouts with lifecycle scripts
disabled. Official actions use reviewed full commit SHAs, credentials are not
persisted, and the only token permission is `contents: read`.

The summary uses GitHub's `GITHUB_STEP_SUMMARY`; oversized reports are kept as an
artifact instead of exceeding the inline size budget. Failed policies/evaluations
still produce the report and fail the check. Invalid input emits a generic failure
without a partial report. Fork approval and repository Actions policy remain in force.

This template intentionally avoids a privileged `pull_request_target` job and a
comment-writing bot. For the job summary mechanism and untrusted checkout guidance,
see [GitHub workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary)
and [secure use](https://docs.github.com/en/actions/reference/security/secure-use).

## Next adoption improvements

Keep the local library boundary. The static read-only comparison view is implemented
in this checkout; [framework lifecycle recipes](../sdk/framework-lifecycle.md) include
a shared startup/close adapter with an executable Node proof. Do not introduce global signal
handlers by default: managed providers already coordinate close and bounded audit
flush, while the application must first stop accepting requests. Flush timeouts cannot
promise that every write is durable or that stalled I/O has been cancelled.

Node 20 is EOL according to the [Node release table](https://nodejs.org/en/about/previous-releases)
checked on 2026-10-30; extending the support promise backwards is not an adoption fix.
Node 26 support is a separate compatibility task with actual cross-platform checks.
No compliance certification, zero-PII guarantee, unmeasured rollback SLO, competitor
benchmark ranking, or independent adopter evidence is introduced by this recipe.
