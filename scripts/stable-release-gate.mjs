import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseChannel } from "./release-channel.mjs";

export const INDEPENDENT_CONSUMER_EVIDENCE_SCHEMA =
  "openfeature-local-provider.independent-consumer-evidence/v1";

const INITIAL_STABLE_VERSION = "1.0.0";
const FIRST_STABLE_MAJOR = 1;
const ACCEPTED_STATUS = "accepted";
const PENDING_STATUS = "pending";
const ACCEPTED_OUTCOME = "passed";
const INDEPENDENT_RELATIONSHIP = "independent";
const REPORT_URL_PATTERN =
  /^https:\/\/github\.com\/0disoft\/openfeature-local-provider-audit\/issues\/[1-9]\d*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function validateStableReleaseEvidence({ packageName, packageVersion, evidence }) {
  const errors = [];
  const requiresIndependentEvidence = isInitialStablePromotion(packageVersion, errors);

  if (!isRecord(evidence)) {
    return {
      errors: [...errors, "independent consumer evidence must be a JSON object"],
      requiresIndependentEvidence
    };
  }

  if (evidence.schemaVersion !== INDEPENDENT_CONSUMER_EVIDENCE_SCHEMA) {
    errors.push(
      `independent consumer evidence schemaVersion must be ${INDEPENDENT_CONSUMER_EVIDENCE_SCHEMA}`
    );
  }

  if (evidence.status !== PENDING_STATUS && evidence.status !== ACCEPTED_STATUS) {
    errors.push('independent consumer evidence status must be "pending" or "accepted"');
  }

  if (!isInitialStableCandidate(evidence.candidateVersion)) {
    errors.push("independent consumer candidateVersion must be a valid 1.0.0 prerelease");
  }

  if (evidence.status === PENDING_STATUS && evidence.acceptedReport !== null) {
    errors.push("pending independent consumer evidence must keep acceptedReport null");
  }

  if (evidence.status === ACCEPTED_STATUS) {
    validateAcceptedReport({
      report: evidence.acceptedReport,
      packageName,
      candidateVersion: evidence.candidateVersion,
      errors
    });
  }

  if (requiresIndependentEvidence && evidence.status !== ACCEPTED_STATUS) {
    errors.push(
      "stable 1.x promotion requires an accepted independently maintained consumer report"
    );
  }

  return { errors, requiresIndependentEvidence };
}

export async function checkStableReleaseGate(root = process.cwd()) {
  const packagePath = path.join(root, "packages", "local-provider", "package.json");
  const evidencePath = path.join(root, "docs", "testing", "independent-consumer-evidence.json");
  const [packageJson, evidence] = await Promise.all([
    readJson(packagePath, "package metadata"),
    readJson(evidencePath, "independent consumer evidence")
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
    errors.push("accepted independent consumer evidence must include acceptedReport");
    return;
  }

  expectNonEmptyString(report.consumerProject, "acceptedReport.consumerProject", errors);
  expectNonEmptyString(report.consumerRevision, "acceptedReport.consumerRevision", errors);
  expectNonEmptyString(report.reviewedBy, "acceptedReport.reviewedBy", errors);

  if (!REPORT_URL_PATTERN.test(report.issueUrl ?? "")) {
    errors.push("acceptedReport.issueUrl must reference an issue in this repository");
  }
  if (report.packageSpec !== `${packageName}@${candidateVersion}`) {
    errors.push(`acceptedReport.packageSpec must be ${packageName}@${candidateVersion}`);
  }
  if (report.normalRegistryInstall !== true) {
    errors.push("acceptedReport.normalRegistryInstall must be true");
  }
  if (report.maintainerRelationship !== INDEPENDENT_RELATIONSHIP) {
    errors.push('acceptedReport.maintainerRelationship must be "independent"');
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
    result.requiresIndependentEvidence
      ? "Stable release gate: accepted independent consumer evidence verified"
      : "Stable release gate: pass (not a stable 1.x promotion)"
  );
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  await main();
}
