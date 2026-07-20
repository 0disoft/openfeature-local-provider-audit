import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseChannel } from "./release-channel.mjs";

export const CROSS_REPOSITORY_CONSUMER_EVIDENCE_SCHEMA =
  "openfeature-local-provider.cross-repository-consumer-evidence/v1";

const INITIAL_STABLE_VERSION = "1.0.0";
const FIRST_STABLE_MAJOR = 1;
const ACCEPTED_STATUS = "accepted";
const PENDING_STATUS = "pending";
const ACCEPTED_OUTCOME = "passed";
const ACCEPTED_MAINTAINER_RELATIONSHIPS = new Set(["independent", "same-maintainer"]);
const REPORT_URL_PATTERN =
  /^https:\/\/github\.com\/0disoft\/openfeature-local-provider-audit\/issues\/[1-9]\d*$/;
const CONSUMER_CI_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[1-9]\d*$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function validateStableReleaseEvidence({ packageName, packageVersion, evidence }) {
  const errors = [];
  const requiresCrossRepositoryEvidence = isInitialStablePromotion(packageVersion, errors);

  if (!isRecord(evidence)) {
    return {
      errors: [...errors, "cross-repository consumer evidence must be a JSON object"],
      requiresCrossRepositoryEvidence
    };
  }

  if (evidence.schemaVersion !== CROSS_REPOSITORY_CONSUMER_EVIDENCE_SCHEMA) {
    errors.push(
      `cross-repository consumer evidence schemaVersion must be ${CROSS_REPOSITORY_CONSUMER_EVIDENCE_SCHEMA}`
    );
  }

  if (evidence.status !== PENDING_STATUS && evidence.status !== ACCEPTED_STATUS) {
    errors.push('cross-repository consumer evidence status must be "pending" or "accepted"');
  }

  if (!isInitialStableCandidate(evidence.candidateVersion)) {
    errors.push("cross-repository consumer candidateVersion must be a valid 1.0.0 prerelease");
  }

  if (evidence.status === PENDING_STATUS && evidence.acceptedReport !== null) {
    errors.push("pending cross-repository consumer evidence must keep acceptedReport null");
  }

  if (evidence.status === ACCEPTED_STATUS) {
    validateAcceptedReport({
      report: evidence.acceptedReport,
      packageName,
      candidateVersion: evidence.candidateVersion,
      errors
    });
  }

  if (requiresCrossRepositoryEvidence && evidence.status !== ACCEPTED_STATUS) {
    errors.push("stable 1.x promotion requires accepted cross-repository consumer evidence");
  }

  return { errors, requiresCrossRepositoryEvidence };
}

export async function checkStableReleaseGate(root = process.cwd()) {
  const packagePath = path.join(root, "packages", "local-provider", "package.json");
  const evidencePath = path.join(
    root,
    "docs",
    "testing",
    "cross-repository-consumer-evidence.json"
  );
  const [packageJson, evidence] = await Promise.all([
    readJson(packagePath, "package metadata"),
    readJson(evidencePath, "cross-repository consumer evidence")
  ]);

  return validateStableReleaseEvidence({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    evidence
  });
}

function isInitialStablePromotion(version, errors) {
  try {
    const channel = resolveReleaseChannel(version);
    const major = Number(version.split(".", 1)[0]);
    return channel.githubPrerelease === false && major >= FIRST_STABLE_MAJOR;
  } catch {
    errors.push(`package version must be valid SemVer, got ${JSON.stringify(version)}`);
    return false;
  }
}

function isInitialStableCandidate(version) {
  try {
    const channel = resolveReleaseChannel(version);
    return channel.githubPrerelease && version.startsWith(`${INITIAL_STABLE_VERSION}-`);
  } catch {
    return false;
  }
}

function validateAcceptedReport({ report, packageName, candidateVersion, errors }) {
  if (!isRecord(report)) {
    errors.push("accepted cross-repository consumer evidence must include acceptedReport");
    return;
  }

  expectNonEmptyString(report.consumerProject, "acceptedReport.consumerProject", errors);
  expectNonEmptyString(report.reviewedBy, "acceptedReport.reviewedBy", errors);

  if (!COMMIT_SHA_PATTERN.test(report.consumerRevision ?? "")) {
    errors.push("acceptedReport.consumerRevision must be a full lowercase Git commit SHA");
  }
  if (!CONSUMER_CI_URL_PATTERN.test(report.consumerCiUrl ?? "")) {
    errors.push("acceptedReport.consumerCiUrl must reference a GitHub Actions run");
  }
  if (!REPORT_URL_PATTERN.test(report.issueUrl ?? "")) {
    errors.push("acceptedReport.issueUrl must reference an issue in this repository");
  }
  if (report.packageSpec !== `${packageName}@${candidateVersion}`) {
    errors.push(`acceptedReport.packageSpec must be ${packageName}@${candidateVersion}`);
  }
  if (report.normalRegistryInstall !== true) {
    errors.push("acceptedReport.normalRegistryInstall must be true");
  }
  if (report.separateRepository !== true) {
    errors.push("acceptedReport.separateRepository must be true");
  }
  if (!ACCEPTED_MAINTAINER_RELATIONSHIPS.has(report.maintainerRelationship)) {
    errors.push('acceptedReport.maintainerRelationship must be "independent" or "same-maintainer"');
  }
  if (report.outcome !== ACCEPTED_OUTCOME) {
    errors.push('acceptedReport.outcome must be "passed"');
  }
  if (
    !ISO_DATE_PATTERN.test(report.reviewedAt ?? "") ||
    Number.isNaN(Date.parse(report.reviewedAt))
  ) {
    errors.push("acceptedReport.reviewedAt must be an ISO 8601 UTC timestamp");
  }
}

function expectNonEmptyString(value, label, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read from ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON at ${filePath}: ${error.message}`);
  }
}

async function main() {
  const result = await checkStableReleaseGate();
  if (result.errors.length > 0) {
    console.error("Stable release gate: blocked");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    result.requiresCrossRepositoryEvidence
      ? "Stable release gate: accepted cross-repository consumer evidence verified"
      : "Stable release gate: pass (not a stable 1.x promotion)"
  );
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  await main();
}
