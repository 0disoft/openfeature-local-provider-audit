import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveReleaseChannel } from "./release-channel.mjs";
import { validateStableReleaseEvidence } from "./stable-release-gate.mjs";

const ROOT = process.cwd();
const PACKAGE_JSON = path.join(ROOT, "packages", "local-provider", "package.json");
const ROOT_PACKAGE_JSON = path.join(ROOT, "package.json");
const RELEASE_WORKFLOW = path.join(ROOT, ".github", "workflows", "release.yml");
const CI_WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");
const COMPATIBILITY_WORKFLOW = path.join(ROOT, ".github", "workflows", "compatibility.yml");
const REGISTRY_CONSUMER_WORKFLOW = path.join(ROOT, ".github", "workflows", "registry-consumer.yml");
const RC_CONSUMER_REPORT_TEMPLATE = path.join(
  ROOT,
  ".github",
  "ISSUE_TEMPLATE",
  "rc-consumer-report.md"
);
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
const API_SURFACE_SCRIPT = path.join(ROOT, "scripts", "api-surface.mjs");
const API_SURFACE_TEST = path.join(ROOT, "scripts", "api-surface.test.mjs");
const API_BASELINE_METADATA = path.join(ROOT, "api", "local-provider.api.json");
const API_BASELINE_DECLARATIONS = path.join(ROOT, "api", "local-provider.api.d.ts");
const AUDIT_QUEUE_BENCHMARK_SCRIPT = path.join(ROOT, "scripts", "audit-queue-benchmark.mjs");
const AUDIT_SINK_SOURCE = path.join(
  ROOT,
  "packages",
  "local-provider",
  "src",
  "audit",
  "audit-sink.ts"
);
const PUBLIC_TYPES_SOURCE = path.join(ROOT, "packages", "local-provider", "src", "public-types.ts");
const PACKAGE_README = path.join(ROOT, "packages", "local-provider", "README.md");
const AUDIT_CONTRACT_DOC = path.join(ROOT, "docs", "library", "audit-event-v1.md");
const COMPATIBILITY_DOC = path.join(ROOT, "docs", "library", "compatibility.md");
const AUDIT_QUEUE_ADR = path.join(ROOT, "docs", "adr", "0010-bounded-audit-queue-default.md");
const PROJECTED_VOLUME_ADR = path.join(ROOT, "docs", "adr", "0011-projected-volume-consistency.md");
const SNAPSHOT_FILE_SOURCE = path.join(
  ROOT,
  "packages",
  "local-provider",
  "src",
  "flags",
  "snapshot-file.ts"
);
const LOCAL_PROVIDER_SOURCE = path.join(
  ROOT,
  "packages",
  "local-provider",
  "src",
  "provider",
  "local-provider.ts"
);
const CONFIGURATION_CHANGE_DOC = path.join(
  ROOT,
  "docs",
  "library",
  "configuration-change-events.md"
);
const SNAPSHOT_WATCH_HANDLE_TEST = path.join(
  ROOT,
  "packages",
  "local-provider",
  "test",
  "flags",
  "snapshot-watch-handle.test.ts"
);
const ROADMAP_DOC = path.join(ROOT, "docs", "product", "01-roadmap.md");
const DEPENDABOT_CONFIG = path.join(ROOT, ".github", "dependabot.yml");
const CODEOWNERS = path.join(ROOT, ".github", "CODEOWNERS");
const SECURITY_POLICY = path.join(ROOT, "SECURITY.md");
const NPM_PUBLISHING_DOC = path.join(ROOT, "docs", "ops", "npm-publishing.md");
const RELEASE_DOC = path.join(ROOT, "docs", "ops", "release.md");
const REGISTRY_CONSUMER_EVIDENCE = path.join(
  ROOT,
  "docs",
  "testing",
  "registry-consumer-evidence.md"
);
const CROSS_REPOSITORY_CONSUMER_EVIDENCE = path.join(
  ROOT,
  "docs",
  "testing",
  "cross-repository-consumer-evidence.json"
);
const RELEASE_CHANNEL_SCRIPT = path.join(ROOT, "scripts", "release-channel.mjs");
const RELEASE_CHANNEL_TEST = path.join(ROOT, "scripts", "release-channel.test.mjs");
const REGISTRY_RELEASE_SCRIPT = path.join(ROOT, "scripts", "registry-release.mjs");
const REGISTRY_RELEASE_TEST = path.join(ROOT, "scripts", "registry-release.test.mjs");
const STABLE_RELEASE_GATE_SCRIPT = path.join(ROOT, "scripts", "stable-release-gate.mjs");
const STABLE_RELEASE_GATE_TEST = path.join(ROOT, "scripts", "stable-release-gate.test.mjs");
const REQUIRED_PACKAGE_FILES = ["bin", "dist", "LICENSE", "README.md"];
const PINNED_ACTION_REF_PATTERN = /^[a-f0-9]{40}$/;

const blockers = [];
const warnings = [];

const rootPackageJson = await readJson(ROOT_PACKAGE_JSON);
const packageJson = await readJson(PACKAGE_JSON);
const releaseWorkflow = await readText(RELEASE_WORKFLOW);
const ciWorkflow = await readText(CI_WORKFLOW);
const compatibilityWorkflow = await readText(COMPATIBILITY_WORKFLOW);
const registryConsumerWorkflow = await readText(REGISTRY_CONSUMER_WORKFLOW);
const rcConsumerReportTemplate = await readText(RC_CONSUMER_REPORT_TEMPLATE);
const auditQueueBenchmarkWorkflow = await readText(AUDIT_QUEUE_BENCHMARK_WORKFLOW);
const auditQueueBenchmarkPlanScript = await readText(AUDIT_QUEUE_BENCHMARK_PLAN_SCRIPT);
const packedSmokeScript = await readText(PACKED_SMOKE_SCRIPT);
const apiSurfaceScript = await readText(API_SURFACE_SCRIPT);
const apiSurfaceTest = await readText(API_SURFACE_TEST);
const apiBaselineMetadata = await readJson(API_BASELINE_METADATA);
const apiBaselineDeclarations = await readText(API_BASELINE_DECLARATIONS);
const auditQueueBenchmarkScript = await readText(AUDIT_QUEUE_BENCHMARK_SCRIPT);
const auditSinkSource = await readText(AUDIT_SINK_SOURCE);
const publicTypesSource = await readText(PUBLIC_TYPES_SOURCE);
const packageReadme = await readText(PACKAGE_README);
const auditContractDoc = await readText(AUDIT_CONTRACT_DOC);
const compatibilityDoc = await readText(COMPATIBILITY_DOC);
const auditQueueAdr = await readText(AUDIT_QUEUE_ADR);
const projectedVolumeAdr = await readText(PROJECTED_VOLUME_ADR);
const snapshotFileSource = await readText(SNAPSHOT_FILE_SOURCE);
const localProviderSource = await readText(LOCAL_PROVIDER_SOURCE);
const configurationChangeDoc = await readText(CONFIGURATION_CHANGE_DOC);
const snapshotWatchHandleTest = await readText(SNAPSHOT_WATCH_HANDLE_TEST);
const roadmapDoc = await readText(ROADMAP_DOC);
const dependabotConfig = await readText(DEPENDABOT_CONFIG);
const codeowners = await readText(CODEOWNERS);
const securityPolicy = await readText(SECURITY_POLICY);
const npmPublishingDoc = await readText(NPM_PUBLISHING_DOC);
const releaseDoc = await readText(RELEASE_DOC);
const registryConsumerEvidence = await readText(REGISTRY_CONSUMER_EVIDENCE);
const crossRepositoryConsumerEvidence = await readJson(CROSS_REPOSITORY_CONSUMER_EVIDENCE);
const releaseChannelScript = await readText(RELEASE_CHANNEL_SCRIPT);
const releaseChannelTest = await readText(RELEASE_CHANNEL_TEST);
const registryReleaseScript = await readText(REGISTRY_RELEASE_SCRIPT);
const registryReleaseTest = await readText(REGISTRY_RELEASE_TEST);
const stableReleaseGateScript = await readText(STABLE_RELEASE_GATE_SCRIPT);
const stableReleaseGateTest = await readText(STABLE_RELEASE_GATE_TEST);

await checkRequiredFiles();
checkRootPackage(rootPackageJson);
checkPackageMetadata(packageJson);
checkReleaseWorkflow(releaseWorkflow);
checkCiWorkflow(ciWorkflow);
checkCompatibilityWorkflow(compatibilityWorkflow, packedSmokeScript);
checkRegistryConsumerWorkflow(registryConsumerWorkflow);
checkRcConsumerReportTemplate(rcConsumerReportTemplate);
checkApiSurfaceContract({
  apiSurfaceScript,
  apiSurfaceTest,
  apiBaselineMetadata,
  apiBaselineDeclarations,
  packageJson
});
checkAuditQueueBenchmarkWorkflow(auditQueueBenchmarkWorkflow, auditQueueBenchmarkPlanScript);
checkAuditQueueContract({
  auditQueueBenchmarkScript,
  auditSinkSource,
  publicTypesSource,
  packageReadme,
  auditContractDoc,
  compatibilityDoc,
  auditQueueAdr
});
checkProjectedVolumeContract({
  projectedVolumeAdr,
  snapshotFileSource,
  localProviderSource,
  publicTypesSource,
  snapshotWatchHandleTest,
  configurationChangeDoc,
  compatibilityDoc,
  roadmapDoc,
  packedSmokeScript
});
checkDependabotConfig(dependabotConfig);
checkMaintenancePolicy(codeowners, securityPolicy);
checkPublishingDocs(npmPublishingDoc, releaseDoc);
checkReleaseChannel(releaseChannelScript, releaseChannelTest);
checkRegistryRelease(registryReleaseScript, registryReleaseTest);
checkRegistryConsumerEvidence(registryConsumerEvidence, packageJson);
checkStableReleaseGate({
  packageJson,
  evidence: crossRepositoryConsumerEvidence,
  script: stableReleaseGateScript,
  testSource: stableReleaseGateTest
});

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
  expectScript(rootPackage, "registry-smoke", "node scripts/packed-smoke.mjs");
  expectScript(rootPackage, "stable-release-gate", "node scripts/stable-release-gate.mjs");
  expectScript(rootPackage, "api:check", "pnpm run build && node scripts/api-surface.mjs --check");
  expectScript(rootPackage, "contract", "pnpm run api:check && pnpm run packed-smoke");
  expectScript(
    rootPackage,
    "migration-check",
    "pnpm run test:migration-tools && node scripts/migration-check.mjs"
  );
  expectScript(rootPackage, "test:api-tools", "node --test scripts/api-surface.test.mjs");
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
  expectScript(rootPackage, "test:migration-tools", "node --test scripts/migration-check.test.mjs");
  expectScript(
    rootPackage,
    "test:release-tools",
    "node --test scripts/release-channel.test.mjs scripts/registry-release.test.mjs scripts/stable-release-gate.test.mjs"
  );
  expectScript(
    rootPackage,
    "test:coverage",
    "pnpm --filter @0disoft/openfeature-local-provider exec vitest run --coverage && pnpm run test:api-tools && pnpm run test:benchmark-tools && pnpm run test:migration-tools && pnpm run test:release-tools"
  );
  expectScriptIncludes(rootPackage, "test", "pnpm run test:benchmark-tools");
  expectScriptIncludes(rootPackage, "test", "pnpm run test:release-tools");
  expectScriptIncludes(rootPackage, "test", "pnpm run test:api-tools");
  expectScriptIncludes(rootPackage, "test", "pnpm run test:migration-tools");
  expectScriptIncludes(rootPackage, "test:coverage", "pnpm run test:api-tools");
  expectScriptIncludes(rootPackage, "test:coverage", "pnpm run test:migration-tools");
  expectScriptIncludes(rootPackage, "check", "pnpm run test:coverage");
  expectScriptIncludes(rootPackage, "check", "pnpm run api:check");
  expectScriptIncludes(rootPackage, "check", "pnpm run migration-check");
  expectScriptIncludes(rootPackage, "check", "pnpm run stable-release-gate");
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
  expectIncludes(workflow, "validate and pack release candidate", "release package job");
  expectIncludes(workflow, "publish or reconcile npm artifact", "release npm job");
  expectIncludes(workflow, "create GitHub Release from registry bytes", "release GitHub job");
  expectIncludes(workflow, "timeout-minutes: 20", "release package timeout");
  expectIncludes(workflow, "timeout-minutes: 10", "release publish timeout");
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
  expectIncludes(workflow, "pnpm run check", "release workflow check gate");
  expectIncludes(
    workflow,
    "pnpm --filter openfeature-local-provider-node-basic-example start",
    "release workflow smoke example"
  );
  expectIncludes(workflow, "pnpm run packed-smoke", "release workflow packed smoke");
  expectIncludes(workflow, "node scripts/release-channel.mjs", "release channel resolver");
  expectIncludes(workflow, "pnpm run stable-release-gate", "stable promotion evidence gate");
  expectIncludes(
    workflow,
    '--tag "${' + '{ needs.package.outputs.npm-tag }}"',
    "release workflow npm publish command"
  );
  expectIncludes(workflow, "steps.registry.outputs.published != 'true'", "npm publish guard");
  expectIncludes(workflow, "registry-release.mjs candidate", "candidate digest recorder");
  expectIncludes(workflow, "registry-release.mjs npm-version", "trusted publishing npm CLI gate");
  expectIncludes(workflow, "registry-release.mjs probe", "npm version probe");
  expectIncludes(workflow, "registry-release.mjs verify", "registry byte verifier");
  expectIncludes(workflow, "candidate-sha256", "candidate SHA-256 handoff");
  expectIncludes(workflow, "openfeature-local-provider-registry-", "verified registry artifact");
  expectIncludes(workflow, "GITHUB_PRERELEASE", "GitHub prerelease marker");
  expectIncludes(
    workflow,
    "GH_REPO: $" + "{{ github.repository }}",
    "GitHub CLI repository context"
  );
  expectIncludes(
    workflow,
    'release create "$' + '{GITHUB_REF_NAME}"',
    "release workflow GitHub Release creation"
  );
  expectIncludes(workflow, "docs/library/migration-to-1.0.md", "release workflow migration guide");
  expectNotMatches(workflow, /node\s+--input-type=module\s+<<|<<['"]?NODE/, "release workflow");
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
  expectIncludes(workflow, "timeout-minutes: 20", "CI job timeout");
  expectIncludes(workflow, "pnpm run format:check", "CI format gate");
  expectIncludes(workflow, "pnpm run lint", "CI lint gate");
  expectIncludes(workflow, "pnpm run typecheck", "CI typecheck gate");
  expectIncludes(workflow, "pnpm run api:check", "CI API surface gate");
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

function checkMaintenancePolicy(codeownersText, securityPolicyText) {
  expectIncludes(codeownersText, "* @0disoft", "default CODEOWNERS rule");
  expectIncludes(
    securityPolicyText,
    "/security/advisories/new",
    "private vulnerability report route"
  );
  expectIncludes(securityPolicyText, "three business days", "security acknowledgement target");
  expectIncludes(
    securityPolicyText,
    "status update at least every seven",
    "security update cadence"
  );
  expectIncludes(securityPolicyText, "calendar days", "security status update target");
  expectIncludes(securityPolicyText, "Do not open public issues", "security disclosure warning");
}

function checkCompatibilityWorkflow(workflow, packedSmokeScript) {
  checkPinnedGitHubActions(workflow, "compatibility workflow");
  expectIncludes(workflow, 'cron: "17 3 * * 1"', "compatibility workflow schedule");
  expectIncludes(workflow, "workflow_dispatch:", "compatibility workflow manual trigger");
  expectIncludes(workflow, "node-version: 24.x", "compatibility workflow Node version");
  expectIncludes(workflow, "timeout-minutes: 15", "compatibility workflow timeout");
  expectIncludes(
    workflow,
    "OPENFEATURE_SERVER_SDK_VERSION: peer",
    "compatibility workflow peer-range selection"
  );
  expectIncludes(workflow, "pnpm run packed-smoke", "compatibility workflow packed smoke");
  expectIncludes(packedSmokeScript, "MAX_PACKED_TARBALL_BYTES = 1_048_576", "packed size budget");
  expectIncludes(packedSmokeScript, "registry-consumer-smoke-passed", "registry consumer result");
  expectIncludes(packedSmokeScript, "--registry-version", "registry consumer version selector");
  expectIncludes(
    packedSmokeScript,
    "spec: `$" + "{PACKAGE_NAME}@$" + "{version}`",
    "registry consumer exact resolved version install"
  );
  expectIncludes(
    packedSmokeScript,
    "requestedVersion: installTarget.requestedVersion",
    "registry consumer requested channel evidence"
  );
  expectIncludes(
    packedSmokeScript,
    "installedPackageJson.version !== installTarget.version",
    "registry installed-version gate"
  );
  expectIncludes(
    packedSmokeScript,
    'pnpm", ["exec", "tsc"',
    "packed smoke TypeScript consumer compile"
  );
  expectIncludes(packedSmokeScript, "PACKED_SMOKE_TARBALL", "packed smoke prebuilt tarball input");
}

function checkRegistryConsumerWorkflow(workflow) {
  checkPinnedGitHubActions(workflow, "registry consumer workflow");
  expectIncludes(workflow, "push:", "registry consumer push trigger");
  expectIncludes(workflow, "branches:", "registry consumer main branch filter");
  expectIncludes(workflow, "- main", "registry consumer main branch");
  expectIncludes(workflow, "paths:", "registry consumer path filter");
  expectIncludes(
    workflow,
    ".github/workflows/registry-consumer.yml",
    "registry consumer workflow path"
  );
  expectIncludes(workflow, "scripts/packed-smoke.mjs", "registry consumer harness path");
  expectIncludes(workflow, "scripts/release-readiness.mjs", "registry readiness path");
  expectIncludes(workflow, "package.json", "registry consumer package script path");
  expectIncludes(workflow, "pnpm-lock.yaml", "registry consumer lockfile path");
  expectIncludes(workflow, 'cron: "41 4 * * 3"', "registry consumer schedule");
  expectIncludes(workflow, "workflow_dispatch:", "registry consumer manual trigger");
  expectIncludes(workflow, "ubuntu-latest", "registry consumer Ubuntu runner");
  expectIncludes(workflow, "windows-latest", "registry consumer Windows runner");
  expectIncludes(workflow, "macos-15", "registry consumer pinned macOS runner");
  expectIncludes(workflow, "timeout-minutes: 15", "registry consumer timeout");
  expectIncludes(workflow, "node-version: 24.x", "registry consumer Node runtime");
  expectIncludes(workflow, "- latest", "registry consumer stable channel");
  expectIncludes(workflow, "- next", "registry consumer prerelease channel");
  expectIncludes(workflow, "pnpm install --frozen-lockfile", "registry consumer install gate");
  expectIncludes(
    workflow,
    'pnpm run registry-smoke --registry-version "$' + '{{ matrix.channel }}"',
    "registry consumer command"
  );
}

function checkRcConsumerReportTemplate(template) {
  expectIncludes(template, "name: Release Candidate Consumer Report", "RC report template name");
  expectIncludes(template, "## Repository separation", "RC report repository section");
  expectIncludes(template, "Consumer commit or immutable revision", "RC report revision evidence");
  expectIncludes(template, "## Package and install path", "RC report install section");
  expectIncludes(template, "Package version", "RC report exact package version");
  expectIncludes(
    template,
    "Clean install without a workspace link",
    "RC report clean install gate"
  );
  expectIncludes(template, "## Environment", "RC report environment section");
  expectIncludes(template, "## Integration exercised", "RC report integration section");
  expectIncludes(template, "## Result", "RC report result section");
  expectIncludes(template, "## Reproduction and evidence", "RC report reproduction section");
  expectIncludes(template, "Separate repository", "RC report repository confirmation");
  expectIncludes(template, "same-maintainer", "RC report ownership disclosure");
}

function checkApiSurfaceContract({
  apiSurfaceScript,
  apiSurfaceTest,
  apiBaselineMetadata,
  apiBaselineDeclarations,
  packageJson
}) {
  expectEqual(
    apiBaselineMetadata.schemaVersion,
    "openfeature-local-provider.api-surface/v1",
    "API baseline schema"
  );
  expectEqual(apiBaselineMetadata.packageName, packageJson.name, "API baseline package name");
  expectEqual(apiBaselineMetadata.version, packageJson.version, "API baseline package version");
  expectEqual(
    apiBaselineMetadata.declarations,
    "local-provider.api.d.ts",
    "API baseline declaration path"
  );
  expectIncludes(apiBaselineDeclarations, "export {", "API declaration baseline export surface");
  expectIncludes(apiSurfaceScript, 'from "typescript"', "API surface TypeScript compiler API");
  expectIncludes(
    apiSurfaceScript,
    "compareDeclarationSurfaces",
    "API surface declaration comparison"
  );
  expectIncludes(apiSurfaceScript, "readImportRuntimeExports", "API surface ESM runtime check");
  expectIncludes(apiSurfaceScript, "readRequireRuntimeExports", "API surface CJS runtime check");
  expectIncludes(apiSurfaceTest, "supporting type changes", "API surface supporting-type test");
  expectIncludes(apiSurfaceTest, "version policy", "API surface version-policy test");
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

function checkAuditQueueContract({
  auditQueueBenchmarkScript,
  auditSinkSource,
  publicTypesSource,
  packageReadme,
  auditContractDoc,
  compatibilityDoc,
  auditQueueAdr
}) {
  expectIncludes(auditSinkSource, "DEFAULT_AUDIT_QUEUE_SIZE = 5_000", "audit queue default source");
  expectIncludes(auditSinkSource, "rejectedWrites += 1", "audit queue reject observability");
  expectIncludes(
    publicTypesSource,
    "readonly maxQueueSize?: number | null",
    "audit queue unbounded opt-out type"
  );
  expectIncludes(
    publicTypesSource,
    "readonly rejectedWrites: number",
    "audit queue rejected stats type"
  );
  expectIncludes(
    auditQueueBenchmarkScript,
    "maxQueueSize: null",
    "audit benchmark explicit unbounded mode"
  );
  expectIncludes(packageReadme, "bounded to 5,000", "package README audit queue default");
  expectIncludes(auditContractDoc, "5,000 writes by default", "audit contract queue default");
  expectIncludes(
    compatibilityDoc,
    "## 0.15.0 Bounded Audit Queue Default",
    "audit queue compatibility version"
  );
  expectIncludes(auditQueueAdr, "Status: Accepted", "audit queue ADR status");
  expectIncludes(auditQueueAdr, "maxQueueSize: null", "audit queue ADR migration opt-out");
}

function checkProjectedVolumeContract({
  projectedVolumeAdr,
  snapshotFileSource,
  localProviderSource,
  publicTypesSource,
  snapshotWatchHandleTest,
  configurationChangeDoc,
  compatibilityDoc,
  roadmapDoc,
  packedSmokeScript
}) {
  expectIncludes(projectedVolumeAdr, "Status: Accepted", "projected-volume ADR status");
  expectIncludes(
    publicTypesSource,
    "readonly consistencyPollIntervalMs?: number",
    "projected-volume public option"
  );
  expectIncludes(snapshotFileSource, "MIN_POLL_INTERVAL_MS = 50", "projected-volume polling floor");
  expectIncludes(snapshotFileSource, "current.ino === previous.ino", "polling inode fingerprint");
  expectIncludes(
    localProviderSource,
    "ProviderEvents.ConfigurationChanged",
    "provider change event"
  );
  expectIncludes(localProviderSource, "flagsChanged:", "provider changed-key payload");
  expectIncludes(
    packedSmokeScript,
    "consistencyPollIntervalMs: 50",
    "packed consistency polling smoke"
  );
  expectIncludes(packedSmokeScript, "ProviderEvents.ConfigurationChanged", "packed event smoke");
  expectIncludes(
    snapshotWatchHandleTest,
    'listener("rename", "..data")',
    "projected-volume event fixture"
  );
  expectIncludes(configurationChangeDoc, "code-unit order", "configuration-change key ordering");
  expectIncludes(
    compatibilityDoc,
    "## 0.16.0 Projected-Volume Consistency And Change Events",
    "projected-volume compatibility version"
  );
  expectIncludes(
    roadmapDoc,
    "Complete the `0.16` projected-volume consistency milestone",
    "projected-volume roadmap completion"
  );
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
    '--tag\n  "${' + '{ steps.channel.outputs.npm-tag }}"',
    "npm publishing doc publish command"
  );
  expectIncludes(npmDoc, "dist-tag `next`", "npm prerelease dist-tag policy");
  expectIncludes(releaseDocText, "npm trusted", "release doc publish method");
  expectIncludes(releaseDocText, "publishing and provenance", "release doc provenance method");
}

function checkReleaseChannel(script, testSource) {
  expectIncludes(script, 'npmTag: prerelease ? "next" : "latest"', "release npm channel policy");
  expectIncludes(script, "githubPrerelease: prerelease", "GitHub prerelease policy");
  expectIncludes(testSource, 'resolveReleaseChannel("1.0.0-rc.1")', "prerelease channel test");
}

function checkRegistryRelease(script, testSource) {
  expectIncludes(script, "11.5.1", "trusted publishing minimum npm CLI");
  expectIncludes(script, "assertTrustedPublishingNpmVersion", "trusted publishing npm CLI check");
  expectIncludes(script, "probeRegistryVersion", "registry version probe");
  expectIncludes(script, "validateRegistryRelease", "registry release validator");
  expectIncludes(script, "verifyRegistryReleaseWithRetry", "registry propagation verifier");
  expectIncludes(script, "Published tarball SHA-256 mismatch", "registry byte identity gate");
  expectIncludes(testSource, "differs from the tested candidate", "registry byte mismatch test");
  expectIncludes(testSource, "supports trusted publishing", "trusted publishing npm CLI test");
  expectIncludes(testSource, "dist-tag", "registry dist-tag test");
  expectIncludes(testSource, "retries bounded registry propagation", "registry retry test");
}

function checkRegistryConsumerEvidence(evidence, localPackage) {
  expectIncludes(evidence, `Package: \`${localPackage.name}@`, "registry evidence package");
  expectIncludes(evidence, "registry-consumer-smoke-passed", "registry evidence result");
  expectIncludes(evidence, "last published candidate", "registry evidence publication boundary");
  expectIncludes(evidence, "npm tarball size:", "registry evidence npm tarball size");
  expectIncludes(
    evidence,
    "GitHub Release tarball size:",
    "registry evidence release tarball size"
  );
  expectIncludes(evidence, "SHA-256 for both public tarballs:", "registry evidence SHA-256");
  expectIncludes(evidence, "npm integrity:", "registry evidence npm integrity");
  expectIncludes(evidence, "same-maintainer", "registry evidence ownership boundary");
  expectIncludes(
    evidence,
    "https://github.com/0disoft/openfeature-local-provider-audit/issues/5",
    "registry evidence external-consumer issue"
  );
  expectIncludes(
    evidence,
    "https://github.com/0disoft/mcp-security-proxy/commit/3814cea2e5539ee0efe2b3f573571fb7a3ea4d21",
    "registry evidence released downstream adoption"
  );
  expectIncludes(
    evidence,
    "@0disoft/mcp-security-proxy-cli@0.2.0-alpha.4",
    "registry evidence downstream release"
  );
  expectIncludes(
    evidence,
    "@0disoft/openfeature-local-provider@1.0.0",
    "registry evidence downstream exact dependency"
  );
  expectIncludes(
    evidence,
    "https://github.com/0disoft/mcp-security-proxy/actions/runs/29732878686",
    "registry evidence downstream registry smoke"
  );
}

function checkStableReleaseGate({ packageJson, evidence, script, testSource }) {
  expectIncludes(script, "validateStableReleaseEvidence", "stable release evidence validator");
  expectIncludes(
    script,
    "stable 1.x promotion requires accepted cross-repository consumer evidence",
    "stable release cross-repository consumer blocker"
  );
  expectIncludes(testSource, 'packageVersion: "1.0.0"', "stable release 1.0.0 regression test");
  expectIncludes(
    testSource,
    "blocks stable 1.0.0 while cross-repository evidence is pending",
    "stable release pending-evidence regression test"
  );

  const result = validateStableReleaseEvidence({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    evidence
  });
  for (const error of result.errors) {
    blockers.push(`stable release gate: ${error}`);
  }
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
  try {
    resolveReleaseChannel(value);
  } catch {
    blockers.push(`${label} must be a valid semver version, got ${format(value)}`);
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
