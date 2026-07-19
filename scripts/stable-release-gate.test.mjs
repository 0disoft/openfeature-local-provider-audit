import assert from "node:assert/strict";
import test from "node:test";
import {
  INDEPENDENT_CONSUMER_EVIDENCE_SCHEMA,
  validateStableReleaseEvidence
} from "./stable-release-gate.mjs";

const PACKAGE_NAME = "@0disoft/openfeature-local-provider";
const CANDIDATE_VERSION = "1.0.0-rc.1";

test("allows the current prerelease while independent evidence is pending", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: CANDIDATE_VERSION,
    evidence: pendingEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresIndependentEvidence: false });
});

test("keeps 0.x stable releases outside the initial 1.0 promotion gate", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "0.16.0",
    evidence: pendingEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresIndependentEvidence: false });
});

test("blocks stable 1.0.0 while independent evidence is pending", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence: pendingEvidence()
  });

  assert.equal(result.requiresIndependentEvidence, true);
  assert.match(result.errors.join("\n"), /requires an accepted independently maintained consumer/);
});

test("does not allow a later stable 1.x version to bypass pending evidence", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.1",
    evidence: pendingEvidence()
  });

  assert.equal(result.requiresIndependentEvidence, true);
  assert.match(result.errors.join("\n"), /stable 1\.x promotion/);
});

test("accepts a complete independent consumer report for stable 1.0.0", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence: acceptedEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresIndependentEvidence: true });
});

test("keeps accepted initial evidence valid for later stable 1.x releases", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.1.0",
    evidence: acceptedEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresIndependentEvidence: true });
});

test("rejects a report that did not use the exact registry candidate", () => {
  const evidence = acceptedEvidence();
  evidence.acceptedReport.packageSpec = `${PACKAGE_NAME}@next`;
  evidence.acceptedReport.normalRegistryInstall = false;

  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence
  });

  assert.match(result.errors.join("\n"), /packageSpec must be/);
  assert.match(result.errors.join("\n"), /normalRegistryInstall must be true/);
});

test("rejects self-maintained, failed, or unreviewed evidence", () => {
  const evidence = acceptedEvidence();
  evidence.acceptedReport.maintainerRelationship = "same-maintainer";
  evidence.acceptedReport.outcome = "failed";
  evidence.acceptedReport.reviewedAt = "2026-07-19";

  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence
  });

  assert.match(result.errors.join("\n"), /maintainerRelationship must be "independent"/);
  assert.match(result.errors.join("\n"), /outcome must be "passed"/);
  assert.match(result.errors.join("\n"), /reviewedAt must be an ISO 8601 UTC timestamp/);
});

test("rejects malformed evidence even before stable promotion", () => {
  const evidence = pendingEvidence();
  evidence.schemaVersion = "unknown";
  evidence.candidateVersion = "1.0.0";
  evidence.acceptedReport = {};

  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: CANDIDATE_VERSION,
    evidence
  });

  assert.equal(result.errors.length, 3);
});

function pendingEvidence() {
  return {
    schemaVersion: INDEPENDENT_CONSUMER_EVIDENCE_SCHEMA,
    status: "pending",
    candidateVersion: CANDIDATE_VERSION,
    acceptedReport: null
  };
}

function acceptedEvidence() {
  return {
    schemaVersion: INDEPENDENT_CONSUMER_EVIDENCE_SCHEMA,
    status: "accepted",
    candidateVersion: CANDIDATE_VERSION,
    acceptedReport: {
      issueUrl: "https://github.com/0disoft/openfeature-local-provider-audit/issues/5",
      consumerProject: "independent/example-consumer",
      consumerRevision: "0123456789abcdef0123456789abcdef01234567",
      packageSpec: `${PACKAGE_NAME}@${CANDIDATE_VERSION}`,
      normalRegistryInstall: true,
      maintainerRelationship: "independent",
      outcome: "passed",
      reviewedBy: "0disoft",
      reviewedAt: "2026-07-19T00:00:00Z"
    }
  };
}
