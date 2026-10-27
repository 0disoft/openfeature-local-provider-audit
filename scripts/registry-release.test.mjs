import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
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

const releaseOptions = {
  packageName: PACKAGE_NAME,
  version: VERSION,
  expectedTag: EXPECTED_TAG,
  candidateSha256: SHA256,
  registryBaseUrl: "https://registry.example.test"
};

test("default verification tolerates more than a minute of propagation without publishing", async () => {
  let reads = 0,
    now = 0;
  const stable = createRegistryFetch();
  const result = await verifyRegistryReleaseWithRetry({
    ...releaseOptions,
    nowImpl: () => now,
    delayImpl: async (ms) => {
      now += ms;
    },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, "GET");
      assert(options.signal instanceof AbortSignal);
      return ++reads <= 13 ? new Response("pending", { status: 404 }) : stable(url);
    }
  });
  assert.equal(now, 65_000);
  assert.equal(reads, 16);
  assert.equal(result.sha256, SHA256);
});

test("retries an independently stale dist-tag after the version becomes visible", async () => {
  let tags = 0,
    waits = 0;
  const stable = createRegistryFetch();
  await verifyRegistryReleaseWithRetry({
    ...releaseOptions,
    attempts: 3,
    delayImpl: async () => {
      waits++;
    },
    fetchImpl: async (url) => {
      if (url.endsWith(encodeURIComponent(PACKAGE_NAME)) && ++tags < 3)
        return Response.json({ "dist-tags": { next: "older" } });
      return stable(url);
    }
  });
  assert.equal(tags, 3);
  assert.equal(waits, 2);
});

for (const status of [404, 408, 425, 429, 500, 503]) {
  test(`retries transient HTTP ${status} reads and consumes failed responses`, async () => {
    let reads = 0,
      cancelled = 0;
    const stable = createRegistryFetch();
    await verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      attempts: 2,
      delayImpl: async () => {},
      fetchImpl: async (url) => {
        if (++reads === 1)
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled++;
              }
            }),
            { status }
          );
        return stable(url);
      }
    });
    assert.equal(reads, 4);
    assert.equal(cancelled, 1);
  });
}

for (const kind of ["401", "403", "json", "hash", "version", "url"]) {
  test(`does not retry permanent ${kind} verification failures`, async () => {
    let reads = 0;
    const stable = createRegistryFetch({
      tarball: kind === "hash" ? Buffer.from("different bytes") : TARBALL
    });
    await assert.rejects(
      verifyRegistryReleaseWithRetry({
        ...releaseOptions,
        attempts: 3,
        delayImpl: async () => {
          assert.fail("permanent failures must not retry");
        },
        fetchImpl: async (url) => {
          reads++;
          if (["401", "403"].includes(kind))
            return new Response("denied", { status: Number(kind) });
          if (kind === "json") return new Response("not json");
          if (kind === "url")
            return Response.json({ version: VERSION, dist: { tarball: "file:///not-network" } });
          if (kind === "version")
            return Response.json({ version: "wrong", dist: { tarball: TARBALL_URL } });
          // A stale tag must not hide a digest mismatch behind transient retries.
          if (kind === "hash" && url.endsWith(encodeURIComponent(PACKAGE_NAME)))
            return Response.json({ "dist-tags": {} });
          return stable(url);
        }
      })
    );
    assert(reads <= 3);
  });
}

test("preserves the original transport cause when retries are exhausted", async () => {
  const cause = new Error("connection reset");
  let reads = 0;
  await assert.rejects(
    verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      attempts: 2,
      delayImpl: async () => {},
      fetchImpl: async () => {
        reads++;
        throw cause;
      }
    }),
    (error) => error.cause?.cause === cause
  );
  assert.equal(reads, 2);
});

test("starts no request at the exact overall deadline even before timers dispatch", async () => {
  let now = 0,
    reads = 0;
  await assert.rejects(
    verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      timeoutMs: 10,
      nowImpl: () => now,
      delayImpl: async () => {
        now += 5;
      },
      fetchImpl: async () => {
        reads++;
        return new Response("pending", { status: 404 });
      }
    }),
    /deadline expired/
  );
  assert.equal(reads, 2);
});

test("rejects a matching response that completes after the attempt deadline", async () => {
  let now = 0;
  const stable = createRegistryFetch();
  await assert.rejects(
    verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      attempts: 1,
      timeoutMs: 100,
      attemptTimeoutMs: 10,
      nowImpl: () => now,
      fetchImpl: async (url) => {
        const response = await stable(url);
        if (url === TARBALL_URL) now = 10;
        return response;
      }
    }),
    (error) => /timed out/.test(error.cause?.message)
  );
});

test("bounds a fetch implementation that ignores cancellation", async () => {
  let signal;
  await assert.rejects(
    verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      timeoutMs: 15,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      }
    }),
    /deadline expired/
  );
  assert.equal(signal.aborted, true);
});

test("includes stalled tarball bodies in the attempt budget", async () => {
  const stable = createRegistryFetch();
  let body;
  try {
    await assert.rejects(
      verifyRegistryReleaseWithRetry({
        ...releaseOptions,
        attempts: 1,
        attemptTimeoutMs: 15,
        fetchImpl: async (url) =>
          url === TARBALL_URL
            ? new Response(
                new ReadableStream({
                  start(controller) {
                    body = controller;
                  }
                })
              )
            : stable(url)
      }),
      (error) => /timed out/.test(error.cause?.message)
    );
  } finally {
    body?.error(new Error("fixture cleanup"));
  }
});

test("preserves caller cancellation while waiting without any additional read", async () => {
  const controller = new AbortController(),
    reason = new Error("operator cancelled");
  let reads = 0;
  await assert.rejects(
    verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      signal: controller.signal,
      fetchImpl: async () => {
        reads++;
        return new Response("pending", { status: 404 });
      },
      delayImpl: async () => {
        controller.abort(reason);
      }
    }),
    (error) => error === reason
  );
  assert.equal(reads, 1);
});

test("a failed or timed out pre-publish probe never means absent", async () => {
  await assert.rejects(
    probeRegistryVersion({
      ...releaseOptions,
      timeoutMs: 15,
      fetchImpl: async () => new Promise(() => {})
    }),
    /probe timed out/
  );
});

test("rejects unsafe timer and retry options before network reads", async () => {
  for (const options of [
    { attempts: 121 },
    { delayMs: 60_001 },
    { timeoutMs: 0 },
    { attemptTimeoutMs: 60_001 },
    { timeoutMs: Number.MAX_SAFE_INTEGER }
  ]) {
    await assert.rejects(
      verifyRegistryReleaseWithRetry({
        ...releaseOptions,
        ...options,
        fetchImpl: async () => {
          assert.fail("invalid options started a read");
        }
      }),
      /must be an integer/
    );
  }
});

test("honors Retry-After without extending the overall deadline", async () => {
  let now = 0,
    reads = 0;
  await assert.rejects(
    verifyRegistryReleaseWithRetry({
      ...releaseOptions,
      timeoutMs: 10_000,
      nowImpl: () => now,
      delayImpl: async (ms) => {
        assert.equal(ms, 30_000);
        now += ms;
      },
      fetchImpl: async () => {
        reads++;
        return new Response("busy", { status: 429, headers: { "retry-after": "30" } });
      }
    }),
    /deadline expired/
  );
  assert.equal(reads, 1);
});

test("native fetch aborts a stalled tarball body within the verification budget", async () => {
  let base,
    tarballReads = 0;
  const methods = [];
  const server = createServer((request, response) => {
    methods.push(request.method);
    if (request.url === "/artifact.tgz") {
      tarballReads++;
      response.writeHead(200);
      response.write("partial tarball");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url.endsWith(VERSION)
          ? { version: VERSION, dist: { tarball: `${base}/artifact.tgz` } }
          : { "dist-tags": { [EXPECTED_TAG]: VERSION } }
      )
    );
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(
      verifyRegistryReleaseWithRetry({
        ...releaseOptions,
        registryBaseUrl: base,
        attempts: 1,
        attemptTimeoutMs: 1000
      }),
      (error) => /timed out/.test(error.cause?.message)
    );
    assert.equal(tarballReads, 1);
    assert.deepEqual(methods, ["GET", "GET", "GET"]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
