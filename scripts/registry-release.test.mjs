import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTrustedPublishingNpmVersion,
  fetchJson,
  fetchRegistryRelease,
  probeRegistryVersion,
  sha256Bytes,
  validateRegistryRelease,
  verifyRegistryReleaseWithRetry
} from "./registry-release.mjs";

const PACKAGE_NAME = "@0disoft/openfeature-local-provider";
const VERSION = "1.0.0-rc.1";
const EXPECTED_TAG = "next";
const TARBALL_URL = "https://registry.example.test/tarballs/provider.tgz";
const TARBALL = Buffer.from("tested release candidate");
const SHA256 = sha256Bytes(TARBALL);

test("requires an npm CLI that supports trusted publishing", () => {
  assert.equal(assertTrustedPublishingNpmVersion("11.5.1"), "11.5.1");
  assert.equal(assertTrustedPublishingNpmVersion("12.0.0"), "12.0.0");
  assert.throws(() => assertTrustedPublishingNpmVersion("11.5.0"), /npm 11\.5\.1 or newer/);
  assert.throws(() => assertTrustedPublishingNpmVersion("11.5"), /three numeric components/);
});

test("validates matching registry metadata, dist-tag, and tarball bytes", async () => {
  const fetchImpl = createRegistryFetch();
  const result = await fetchRegistryRelease({
    packageName: PACKAGE_NAME,
    version: VERSION,
    expectedTag: EXPECTED_TAG,
    candidateSha256: SHA256,
    registryBaseUrl: "https://registry.example.test/",
    fetchImpl
  });

  assert.equal(result.version, VERSION);
  assert.equal(result.npmTag, EXPECTED_TAG);
  assert.equal(result.sha256, SHA256);
  assert.deepEqual(result.tarball, TARBALL);
});

test("rejects a registry tarball that differs from the tested candidate", async () => {
  const differentTarball = Buffer.from("different published bytes");
  const fetchImpl = createRegistryFetch({ tarball: differentTarball });

  await assert.rejects(
    fetchRegistryRelease({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedTag: EXPECTED_TAG,
      candidateSha256: SHA256,
      registryBaseUrl: "https://registry.example.test",
      fetchImpl
    }),
    /Published tarball SHA-256 mismatch/
  );
});

test("probes an absent version without treating other registry failures as absence", async () => {
  assert.equal(
    await probeRegistryVersion({
      packageName: PACKAGE_NAME,
      version: VERSION,
      registryBaseUrl: "https://registry.example.test",
      fetchImpl: async () => new Response("not found", { status: 404 })
    }),
    false
  );

  await assert.rejects(
    probeRegistryVersion({
      packageName: PACKAGE_NAME,
      version: VERSION,
      registryBaseUrl: "https://registry.example.test",
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    }),
    /HTTP 503/
  );
});

test("retries bounded registry propagation before accepting matching bytes", async () => {
  let requests = 0;
  let delays = 0;
  const stableFetch = createRegistryFetch();
  const fetchImpl = async (...args) => {
    requests += 1;
    if (requests <= 2) {
      return new Response("not ready", { status: 404 });
    }
    return stableFetch(...args);
  };

  const result = await verifyRegistryReleaseWithRetry({
    packageName: PACKAGE_NAME,
    version: VERSION,
    expectedTag: EXPECTED_TAG,
    candidateSha256: SHA256,
    registryBaseUrl: "https://registry.example.test",
    fetchImpl,
    attempts: 3,
    delayMs: 0,
    delayImpl: async () => {
      delays += 1;
    }
  });

  assert.equal(result.sha256, SHA256);
  assert.equal(delays, 2);
});

test("validates the expected dist-tag independently from the version metadata", () => {
  assert.throws(
    () =>
      validateRegistryRelease({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedTag: EXPECTED_TAG,
        candidateSha256: SHA256,
        registrySha256: SHA256,
        versionMetadata: { version: VERSION, dist: { tarball: TARBALL_URL } },
        rootMetadata: { "dist-tags": { latest: VERSION } }
      }),
    /npm dist-tag next/
  );
});

test("rejects incomplete registry version metadata", () => {
  assert.throws(
    () =>
      validateRegistryRelease({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedTag: EXPECTED_TAG,
        candidateSha256: SHA256,
        registrySha256: SHA256,
        versionMetadata: { version: VERSION, dist: {} },
        rootMetadata: { "dist-tags": { [EXPECTED_TAG]: VERSION } }
      }),
    /missing dist\.tarball/
  );
});

test("reports HTTP and invalid JSON metadata failures", async () => {
  await assert.rejects(
    fetchJson(
      "https://registry.example.test/package",
      async () => new Response("down", { status: 503 })
    ),
    /HTTP 503/
  );
  await assert.rejects(
    fetchJson(
      "https://registry.example.test/package",
      async () => new Response("not-json"),
      "package metadata"
    ),
    /package metadata response was not valid JSON/
  );
});

test("reports registry tarball HTTP failures", async () => {
  const fetchImpl = createRegistryFetch({ tarballStatus: 502 });
  await assert.rejects(
    fetchRegistryRelease({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedTag: EXPECTED_TAG,
      candidateSha256: SHA256,
      registryBaseUrl: "https://registry.example.test",
      fetchImpl
    }),
    /Registry tarball request failed with HTTP 502/
  );
});

function createRegistryFetch({ tarball = TARBALL, tarballStatus = 200 } = {}) {
  const packageBase = `https://registry.example.test/${encodeURIComponent(PACKAGE_NAME)}`;
  return async (url) => {
    if (url === `${packageBase}/${VERSION}`) {
      return Response.json({ version: VERSION, dist: { tarball: TARBALL_URL } });
    }
    if (url === packageBase) {
      return Response.json({ "dist-tags": { [EXPECTED_TAG]: VERSION } });
    }
    if (url === TARBALL_URL) {
      return new Response(tarball, { status: tarballStatus });
    }
    return new Response("not found", { status: 404 });
  };
}
