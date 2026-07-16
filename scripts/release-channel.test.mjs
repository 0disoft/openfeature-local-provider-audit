import assert from "node:assert/strict";
import test from "node:test";
import { resolveReleaseChannel } from "./release-channel.mjs";

test("routes stable versions to latest", () => {
  assert.deepEqual(resolveReleaseChannel("1.0.0"), {
    version: "1.0.0",
    npmTag: "latest",
    githubPrerelease: false
  });
});

test("routes prerelease versions to next", () => {
  assert.deepEqual(resolveReleaseChannel("1.0.0-rc.1"), {
    version: "1.0.0-rc.1",
    npmTag: "next",
    githubPrerelease: true
  });
});

test("accepts build metadata without changing a stable channel", () => {
  assert.equal(resolveReleaseChannel("1.0.0+build.7").npmTag, "latest");
  assert.equal(resolveReleaseChannel("1.0.0+build-x").npmTag, "latest");
});

test("rejects malformed versions", () => {
  assert.throws(() => resolveReleaseChannel("v1.0.0"), /Invalid release version/);
  assert.throws(() => resolveReleaseChannel("1.0"), /Invalid release version/);
  assert.throws(() => resolveReleaseChannel("1.0.0-01"), /Invalid release version/);
});
