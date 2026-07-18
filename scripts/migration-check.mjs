import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_MIGRATION_LITERALS = Object.freeze([
  "## Supported starting versions",
  "## Upgrade from 0.15.x",
  "## Upgrade from 0.16.x",
  "## Contracts unchanged for 1.0 RC",
  "## RC install and verification",
  "## Rollback",
  "## Evidence map",
  "## Evidence status",
  "`schemaVersion: 1`",
  "`@openfeature/server-sdk` supplied as peer dependency `^1.22.0`",
  "`STATIC`, `DEFAULT`, `ENV_OVERRIDE`, `SPLIT`, and `ERROR`",
  "`PARSE_ERROR`, `SCHEMA_ERROR`, `FLAG_NOT_FOUND`, `TYPE_MISMATCH`",
  "5,000 pending writes and `reject` by default",
  "`maxQueueSize: null` as the explicit unbounded choice",
  "consistency polling remains opt-in with a 50 ms floor",
  "exit codes `0` for success, `1` for snapshot failure, and `2` for usage error",
  "prereleases must not replace `latest`",
  "They are not a substitute for installing the exact npm artifact.",
  "Candidate publication: not yet evidenced by this document.",
  "Independently maintained consumer result: not yet evidenced by this document."
]);

const PACKAGE_PATH = path.join("packages", "local-provider", "package.json");
const GUIDE_PATH = path.join("docs", "library", "migration-to-1.0.md");

export function validateMigrationGuide({ packageVersion, guide }) {
  const errors = [];
  const normalizedGuide = normalizeWhitespace(guide);
  const versionLine = `Current repository package version: \`${packageVersion}\`.`;
  const evidenceLine = `Current source baseline: repository package version \`${packageVersion}\`.`;

  if (!normalizedGuide.includes(normalizeWhitespace(versionLine))) {
    errors.push(`migration guide must link its current package version with: ${versionLine}`);
  }
  if (!normalizedGuide.includes(normalizeWhitespace(evidenceLine))) {
    errors.push(
      `migration guide evidence status must link the package version with: ${evidenceLine}`
    );
  }

  for (const literal of REQUIRED_MIGRATION_LITERALS) {
    if (!normalizedGuide.includes(normalizeWhitespace(literal))) {
      errors.push(`migration guide is missing required contract inventory: ${literal}`);
    }
  }

  return errors;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export async function checkMigrationGuide(root = process.cwd()) {
  const packageJson = JSON.parse(await readFile(path.join(root, PACKAGE_PATH), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    return ["packages/local-provider/package.json must declare a non-empty version"];
  }

  const guide = await readFile(path.join(root, GUIDE_PATH), "utf8");
  return validateMigrationGuide({ packageVersion: packageJson.version, guide });
}

async function main() {
  const errors = await checkMigrationGuide();
  if (errors.length === 0) {
    console.log("Migration check passed.");
    return;
  }

  console.error("Migration check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  await main();
}
