import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PACKAGE_JSON = path.join(ROOT, "packages", "local-provider", "package.json");
const ROOT_PACKAGE_JSON = path.join(ROOT, "package.json");
const RELEASE_WORKFLOW = path.join(ROOT, ".github", "workflows", "release.yml");
const CI_WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");
const COMPATIBILITY_WORKFLOW = path.join(ROOT, ".github", "workflows", "compatibility.yml");
const AUDIT_QUEUE_BENCHMARK_WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "audit-queue-benchmark.yml"
);
const AUDIT_QUEUE_BENCHMARK_PLAN_SCRIPT = path.join(
  ROOT,
  "scripts",
  "audit-queue-benchmark-plan.mjs"
);
const PACKED_SMOKE_SCRIPT = path.join(ROOT, "scripts", "packed-smoke.mjs");
const DEPENDABOT_CONFIG = path.join(ROOT, ".github", "dependabot.yml");
const NPM_PUBLISHING_DOC = path.join(ROOT, "docs", "ops", "npm-publishing.md");
const RELEASE_DOC = path.join(ROOT, "docs", "ops", "release.md");
const REQUIRED_PACKAGE_FILES = ["bin", "dist", "LICENSE", "README.md"];
const PINNED_ACTION_REF_PATTERN = /^[a-f0-9]{40}$/;

const blockers = [];
const warnings = [];

const rootPackageJson = await readJson(ROOT_PACKAGE_JSON);
const packageJson = await readJson(PACKAGE_JSON);
const releaseWorkflow = await readText(RELEASE_WORKFLOW);
const ciWorkflow = await readText(CI_WORKFLOW);
const compatibilityWorkflow = await readText(COMPATIBILITY_WORKFLOW);
const auditQueueBenchmarkWorkflow = await readText(AUDIT_QUEUE_BENCHMARK_WORKFLOW);
const auditQueueBenchmarkPlanScript = await readText(AUDIT_QUEUE_BENCHMARK_PLAN_SCRIPT);
const packedSmokeScript = await readText(PACKED_SMOKE_SCRIPT);
const dependabotConfig = await readText(DEPENDABOT_CONFIG);
const npmPublishingDoc = await readText(NPM_PUBLISHING_DOC);
const releaseDoc = await readText(RELEASE_DOC);

await checkRequiredFiles();
checkRootPackage(rootPackageJson);
checkPackageMetadata(packageJson);
checkReleaseWorkflow(releaseWorkflow);
checkCiWorkflow(ciWorkflow);
checkCompatibilityWorkflow(compatibilityWorkflow, packedSmokeScript);
checkAuditQueueBenchmarkWorkflow(auditQueueBenchmarkWorkflow, auditQueueBenchmarkPlanScript);
checkDependabotConfig(dependabotConfig);
checkPublishingDocs(npmPublishingDoc, releaseDoc);

if (blockers.length > 0) {
  console.error("Release readiness: blocked");
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  if (warnings.length > 0) {
    console.error("Warnings:");
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }
  process.exitCode = 1;
} else {
  console.log("Release readiness: ready");
  for (const warning of warnings) {
    console.log(`warning: ${warning}`);
  }
}

async function readText(filePath) {
  return readFile(filePath, "utf8").catch((error) => {
    blockers.push(`${relative(filePath)} could not be read: ${error.message}`);
    return "";
  });
}

async function readJson(filePath) {
  const text = await readText(filePath);
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    blockers.push(`${relative(filePath)} is not valid JSON: ${error.message}`);
    return {};
  }
}

async function checkRequiredFiles() {
  for (const filePath of [
    "LICENSE",
    "SECURITY.md",
    "README.md",
    "packages/local-provider/LICENSE",
    "packages/local-provider/README.md"
  ]) {
    await access(path.join(ROOT, filePath)).catch(() => {
      blockers.push(`required release file is missing: ${filePath}`);
    });
  }
}

function checkRootPackage(rootPackage) {
  expectEqual(rootPackage.private, true, "root package.json private");
  expectEqual(rootPackage.packageManager, "pnpm@11.7.0", "root package manager");
  expectEqual(rootPackage.engines?.node, ">=22 <25", "root Node engine range");
  expectScript(rootPackage, "release-readiness", "node scripts/release-readiness.mjs");
  expectScript(rootPackage, "packed-smoke", "node scripts/packed-smoke.mjs");
  expectScript(
    rootPackage,
    "benchmark:audit-queue",
    "pnpm run build && node --expose-gc scripts/audit-queue-benchmark.mjs"
  );
  expectScript(
    rootPackage,
    "benchmark:audit-queue:plan",
    "node scripts/audit-queue-benchmark-plan.mjs"
  );
  expectScript(
    rootPackage,
    "benchmark:audit-queue:summarize",
    "node scripts/audit-queue-benchmark-summary.mjs"
  );
  expectScript(
    rootPackage,
    "test:benchmark-tools",
    "node --test scripts/audit-queue-benchmark-summary.test.mjs"
  );
  expectScript(
    rootPackage,
    "test:coverage",
    "pnpm --filter @0disoft/openfeature-local-provider exec vitest run --coverage && pnpm run test:benchmark-tools"
  );
  expectScriptIncludes(rootPackage, "test", "pnpm run test:benchmark-tools");
  expectScriptIncludes(rootPackage, "check", "pnpm run test:coverage");
  expectScriptIncludes(rootPackage, "check", "pnpm run release-readiness");
  expectScriptIncludes(
    rootPackage,
    "typecheck",
    "pnpm --filter @0disoft/openfeature-local-provider build"
  );
  expectScriptIncludes(rootPackage, "typecheck", "examples/node-basic/tsconfig.json");
}

function checkPackageMetadata(localPackage) {
  expectEqual(localPackage.name, "@0disoft/openfeature-local-provider", "package name");
  expectSemver(localPackage.version, "package version");
  expectEqual(localPackage.private, undefined, "package private flag");
  expectEqual(localPackage.license, "Apache-2.0", "package license");
  expectEqual(localPackage.type, "module", "package type");
  expectEqual(localPackage.main, "./dist/index.cjs", "package CJS entry");
  expectEqual(localPackage.module, "./dist/index.js", "package ESM entry");
  expectEqual(localPackage.types, "./dist/index.d.ts", "package types entry");
  expectEqual(
    localPackage.bin?.["openfeature-local-provider"],
    "./bin/openfeature-local-provider.js",
    "package CLI bin entry"
  );
  expectEqual(localPackage.engines?.node, ">=22 <25", "package Node engine range");
  expectEqual(
    localPackage.peerDependencies?.["@openfeature/server-sdk"],
    "^1.22.0",
    "OpenFeature peer dependency"
  );
  expectEqual(localPackage.repository?.type, "git", "package repository type");
  expectEqual(
    localPackage.repository?.url,
    "git+https://github.com/0disoft/openfeature-local-provider-audit.git",
    "package repository url"
  );
  expectEqual(
    localPackage.repository?.directory,
    "packages/local-provider",
    "package repository directory"
  );
  for (const filePath of REQUIRED_PACKAGE_FILES) {
    if (!Array.isArray(localPackage.files) || !localPackage.files.includes(filePath)) {
      blockers.push(`package files must include ${filePath}`);
    }
  }
}

function checkReleaseWorkflow(workflow) {
  checkPinnedGitHubActions(workflow, "release workflow");
  expectIncludes(
    workflow,
    "contents: write",
    "release workflow must be able to create GitHub Releases"
  );
  expectIncludes(workflow, "id-token: write", "release workflow must allow npm OIDC provenance");
  expectIncludes(workflow, "node-version: 24.x", "release workflow Node runtime");
  expectIncludes(
    workflow,
    "registry-url: https://registry.npmjs.org",
    "release workflow npm registry"
  );
  expectIncludes(
    workflow,
    "package-manager-cache: false",
    "release workflow setup-node cache policy"
  );
  expectIncludes(workflow, "pnpm install --frozen-lockfile", "release workflow install gate");
  expectIncludes(workflow, "fetch-depth: 0", "release workflow complete history checkout");
  expectIncludes(
    workflow,
    "git fetch origin main:refs/remotes/origin/main --no-tags",
    "release workflow explicit main fetch"
  );
  expectIncludes(
    workflow,
    'git merge-base --is-ancestor "$' + '{GITHUB_SHA}" "origin/main"',
    "release workflow main ancestry gate"
  );
  expectIncludes(workflow, "pnpm run release-readiness", "release workflow readiness gate");
  expectIncludes(workflow, "pnpm run check", "release workflow check gate");
  expectIncludes(
    workflow,
    "pnpm --filter openfeature-local-provider-node-basic-example start",
    "release workflow smoke example"
  );
  expectIncludes(workflow, "pnpm run packed-smoke", "release workflow packed smoke");
  expectIncludes(
    workflow,
    'npm publish "${' + '{ steps.pack.outputs.tarball }}" --provenance --access public',
    "release workflow npm publish command"
  );
  expectIncludes(workflow, "gh release create", "release workflow GitHub Release creation");
  expectIncludes(
    workflow,
    'if npm view "@0disoft/openfeature-local-provider@$' + '{package_version}" version',
    "release workflow published-version guard"
  );
  expectNotMatches(
    workflow,
    /\b(NPM_TOKEN|NODE_AUTH_TOKEN|NPM_PUBLISH_TOKEN|_authToken)\b/,
    "release workflow"
  );
}

function checkCiWorkflow(workflow) {
  checkPinnedGitHubActions(workflow, "CI workflow");
  expectIncludes(workflow, "ubuntu-latest", "CI Ubuntu runner matrix");
  expectIncludes(workflow, "windows-latest", "CI Windows runner matrix");
  expectIncludes(workflow, "macos-15", "CI pinned macOS runner matrix");
  expectNotMatches(workflow, /\bmacos-latest\b/, "CI workflow macOS runner matrix");
  expectIncludes(workflow, "22.x", "CI Node 22 matrix");
  expectIncludes(workflow, "24.x", "CI Node 24 matrix");
  expectIncludes(workflow, "pnpm run format:check", "CI format gate");
  expectIncludes(workflow, "pnpm run lint", "CI lint gate");
  expectIncludes(workflow, "pnpm run typecheck", "CI typecheck gate");
  expectIncludes(workflow, "pnpm run test", "CI test gate");
  expectIncludes(workflow, "pnpm run test:coverage", "CI coverage gate");
  expectIncludes(workflow, "pnpm run release-readiness", "CI release readiness gate");
  expectIncludes(workflow, "pnpm run pack:check", "CI package gate");
  expectIncludes(
    workflow,
    "pnpm --filter openfeature-local-provider-node-basic-example start",
    "CI smoke example"
  );
  expectIncludes(workflow, "pnpm run packed-smoke", "CI packed smoke");
}

function checkDependabotConfig(config) {
  expectIncludes(config, "version: 2", "Dependabot config version");
  expectIncludes(config, 'package-ecosystem: "npm"', "Dependabot npm ecosystem");
  expectIncludes(config, 'directory: "/"', "Dependabot workspace root");
  expectIncludes(config, 'interval: "monthly"', "Dependabot update schedule");
  expectIncludes(config, 'dependency-type: "development"', "Dependabot development grouping");
  expectIncludes(config, "update-types:", "Dependabot grouped update types");
}

function checkCompatibilityWorkflow(workflow, packedSmokeScript) {
  checkPinnedGitHubActions(workflow, "compatibility workflow");
  expectIncludes(workflow, 'cron: "17 3 * * 1"', "compatibility workflow schedule");
  expectIncludes(workflow, "workflow_dispatch:", "compatibility workflow manual trigger");
  expectIncludes(workflow, "node-version: 24.x", "compatibility workflow Node version");
  expectIncludes(
    workflow,
    "OPENFEATURE_SERVER_SDK_VERSION: peer",
    "compatibility workflow peer-range selection"
  );
  expectIncludes(workflow, "pnpm run packed-smoke", "compatibility workflow packed smoke");
  expectIncludes(
    packedSmokeScript,
    'pnpm", ["exec", "tsc"',
    "packed smoke TypeScript consumer compile"
  );
  expectIncludes(packedSmokeScript, "PACKED_SMOKE_TARBALL", "packed smoke prebuilt tarball input");
}

function checkAuditQueueBenchmarkWorkflow(workflow, planScript) {
  checkPinnedGitHubActions(workflow, "audit queue benchmark workflow");
  expectIncludes(workflow, "workflow_dispatch:", "audit queue benchmark manual trigger");
  expectNotMatches(
    workflow,
    /^\s{2}(?:push|pull_request|schedule):/gm,
    "audit queue benchmark automatic trigger"
  );
  expectIncludes(workflow, "contents: read", "audit queue benchmark permissions");
  expectIncludes(workflow, "type: choice", "audit queue benchmark profile choice");
  expectIncludes(workflow, "- decision", "audit queue benchmark decision profile");
  expectIncludes(workflow, "cancel-in-progress: false", "audit queue benchmark concurrency");
  expectIncludes(workflow, "timeout-minutes: 15", "audit queue benchmark timeout");
  expectIncludes(planScript, 'os: "ubuntu-latest"', "audit queue benchmark Ubuntu runner");
  expectIncludes(planScript, 'os: "windows-latest"', "audit queue benchmark Windows runner");
  expectIncludes(planScript, 'os: "macos-15"', "audit queue benchmark macOS runner");
  expectIncludes(planScript, "stallMs: 1_000", "audit queue benchmark short stall profile");
  expectIncludes(planScript, "stallMs: 5_000", "audit queue benchmark medium stall profile");
  expectIncludes(planScript, "stallMs: 30_000", "audit queue benchmark sustained stall profile");
  expectIncludes(planScript, "repetitions: 3", "audit queue benchmark decision repetitions");
  expectIncludes(workflow, "node-version: 24.x", "audit queue benchmark Node runtime");
  expectIncludes(workflow, "pnpm install --frozen-lockfile", "audit queue benchmark install gate");
  expectIncludes(workflow, "pnpm run build", "audit queue benchmark build gate");
  expectIncludes(
    workflow,
    "scripts/audit-queue-benchmark-plan.mjs",
    "audit queue benchmark plan command"
  );
  expectIncludes(workflow, "--github-output", "audit queue benchmark plan output");
  expectIncludes(workflow, "max-parallel: 9", "audit queue benchmark parallel job limit");
  expectIncludes(
    workflow,
    "matrix: $" + "{{ fromJSON(needs.plan.outputs.matrix) }}",
    "audit queue benchmark dynamic matrix"
  );
  expectIncludes(workflow, "scripts/audit-queue-benchmark.mjs", "audit queue benchmark command");
  expectIncludes(workflow, "--repetition", "audit queue benchmark repetition metadata");
  expectIncludes(workflow, "--output", "audit queue benchmark JSON output");
  expectIncludes(workflow, "actions/upload-artifact@", "audit queue benchmark artifact upload");
  expectIncludes(
    workflow,
    "needs:\n      - plan\n      - benchmark",
    "audit queue benchmark summary dependencies"
  );
  expectIncludes(workflow, "actions/download-artifact@", "audit queue benchmark artifact download");
  expectIncludes(workflow, "pattern: audit-queue-*", "audit queue benchmark artifact pattern");
  expectIncludes(
    workflow,
    "scripts/audit-queue-benchmark-summary.mjs",
    "audit queue benchmark summary command"
  );
  expectIncludes(workflow, "--github-summary", "audit queue benchmark GitHub summary");
  expectIncludes(workflow, "name: audit-queue-summary", "audit queue benchmark summary artifact");
  expectIncludes(workflow, "if-no-files-found: error", "audit queue benchmark artifact gate");
}

function checkPinnedGitHubActions(workflow, label) {
  const actionRefs = Array.from(
    workflow.matchAll(/^\s*uses:\s+actions\/([a-z0-9-]+)@([^\s#]+)/gim)
  );

  if (actionRefs.length === 0) {
    blockers.push(`${label} must use pinned official GitHub Actions`);
    return;
  }

  for (const [, actionName, ref] of actionRefs) {
    if (!PINNED_ACTION_REF_PATTERN.test(ref)) {
      blockers.push(`${label} action actions/${actionName} must be pinned to a full commit SHA`);
    }
  }
}

function checkPublishingDocs(npmDoc, releaseDocText) {
  expectIncludes(npmDoc, "npm trusted publishing", "npm publishing doc trusted publisher decision");
  expectIncludes(npmDoc, "openfeature-local-provider-audit", "npm publishing doc repository name");
  expectIncludes(npmDoc, "release.yml", "npm publishing doc workflow filename");
  expectIncludes(
    npmDoc,
    'npm publish "${' + '{ steps.pack.outputs.tarball }}" --provenance --access public',
    "npm publishing doc publish command"
  );
  expectIncludes(
    releaseDocText,
    "npm trusted publishing and provenance",
    "release doc publish method"
  );
}

function expectScript(packageObject, name, expected) {
  expectEqual(packageObject.scripts?.[name], expected, `package script ${name}`);
}

function expectScriptIncludes(packageObject, name, expected) {
  const value = packageObject.scripts?.[name];
  if (typeof value !== "string" || !value.includes(expected)) {
    blockers.push(`package script ${name} must include ${expected}`);
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    blockers.push(`${label} must be ${format(expected)}, got ${format(actual)}`);
  }
}

function expectSemver(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    blockers.push(`${label} must be a stable semver version, got ${format(value)}`);
  }
}

function expectIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    blockers.push(`${label} is missing ${format(expected)}`);
  }
}

function expectNotMatches(text, pattern, label) {
  if (pattern.test(text)) {
    blockers.push(`${label} must not reference ${pattern}`);
  }
}

function format(value) {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}
