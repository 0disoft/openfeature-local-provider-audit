import assert from "node:assert/strict";
import test from "node:test";
import {
  CROSS_REPOSITORY_CONSUMER_EVIDENCE_SCHEMA,
  validateStableReleaseEvidence
} from "./stable-release-gate.mjs";

const PACKAGE_NAME = "@0disoft/openfeature-local-provider";
const CANDIDATE_VERSION = "1.0.0-rc.2";

test("allows the current prerelease while cross-repository evidence is pending", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: CANDIDATE_VERSION,
    evidence: pendingEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresCrossRepositoryEvidence: false });
});

test("keeps 0.x stable releases outside the initial 1.0 promotion gate", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "0.16.0",
    evidence: pendingEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresCrossRepositoryEvidence: false });
});

test("blocks stable 1.0.0 while cross-repository evidence is pending", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence: pendingEvidence()
  });

  assert.equal(result.requiresCrossRepositoryEvidence, true);
  assert.match(result.errors.join("\n"), /requires accepted cross-repository consumer evidence/);
});

test("does not allow a later stable 1.x version to bypass pending evidence", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.1",
    evidence: pendingEvidence()
  });

  assert.equal(result.requiresCrossRepositoryEvidence, true);
  assert.match(result.errors.join("\n"), /stable 1\.x promotion/);
});

test("accepts complete same-maintainer cross-repository evidence for stable 1.0.0", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence: acceptedEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresCrossRepositoryEvidence: true });
});

test("keeps accepted initial evidence valid for later stable 1.x releases", () => {
  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.1.0",
    evidence: acceptedEvidence()
  });

  assert.deepEqual(result, { errors: [], requiresCrossRepositoryEvidence: true });
});

test("rejects evidence that did not use the exact registry candidate", () => {
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

test("rejects same-repository, undisclosed, failed, or unreviewed evidence", () => {
  const evidence = acceptedEvidence();
  evidence.acceptedReport.consumerRevision = "119b211";
  evidence.acceptedReport.consumerCiUrl = "https://example.com/run/1";
  evidence.acceptedReport.separateRepository = false;
  evidence.acceptedReport.maintainerRelationship = "undisclosed";
  evidence.acceptedReport.outcome = "failed";
  evidence.acceptedReport.reviewedAt = "2026-07-20";

  const result = validateStableReleaseEvidence({
    packageName: PACKAGE_NAME,
    packageVersion: "1.0.0",
    evidence
  });

  assert.match(
    result.errors.join("\n"),
    /consumerRevision must be a full lowercase Git commit SHA/
  );
  assert.match(result.errors.join("\n"), /consumerCiUrl must reference a GitHub Actions run/);
  assert.match(result.errors.join("\n"), /separateRepository must be true/);
  assert.match(result.errors.join("\n"), /maintainerRelationship must be/);
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
    schemaVersion: CROSS_REPOSITORY_CONSUMER_EVIDENCE_SCHEMA,
    status: "pending",
    candidateVersion: CANDIDATE_VERSION,
    acceptedReport: null
  };
}

function acceptedEvidence() {
  return {
    schemaVersion: CROSS_REPOSITORY_CONSUMER_EVIDENCE_SCHEMA,
    status: "accepted",
    candidateVersion: CANDIDATE_VERSION,
    acceptedReport: {
      issueUrl: "https://github.com/0disoft/openfeature-local-provider-audit/issues/5",
      consumerProject: "0disoft/service-catalog-generator",
      consumerRevision: "119b211f49e9a4824ab168fb4c92bce1a4655908",
      consumerCiUrl:
        "https://github.com/0disoft/service-catalog-generator/actions/runs/29716348265",
      packageSpec: `${PACKAGE_NAME}@${CANDIDATE_VERSION}`,
      normalRegistryInstall: true,
      separateRepository: true,
      maintainerRelationship: "same-maintainer",
      outcome: "passed",
      reviewedBy: "0disoft",
      reviewedAt: "2026-07-20T04:35:44Z"
    }
  };
}
