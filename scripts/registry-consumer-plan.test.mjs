import assert from "node:assert/strict";
import test from "node:test";
import { selectRegistryMatrix } from "./registry-consumer-plan.mjs";

test("superseded next creates only three stable platform jobs", () => {
  const matrix = selectRegistryMatrix({ latest: "1.0.0", next: "1.0.0-rc.2" });
  assert.deepEqual(
    matrix.include,
    ["ubuntu-latest", "windows-latest", "macos-15"].map((os) => ({
      os,
      channel: "latest",
      version: "1.0.0"
    }))
  );
});

test("newer prerelease adds next on all three platforms", () => {
  const matrix = selectRegistryMatrix({ latest: "1.0.0", next: "1.1.0-rc.1" });
  assert.equal(matrix.include.length, 6);
  assert.deepEqual(
    matrix.include.slice(3).map((entry) => entry.version),
    Array(3).fill("1.1.0-rc.1")
  );
});

test("missing, malformed, equal, stable, or older next leaves stable coverage intact", () => {
  for (const next of [
    undefined,
    null,
    7,
    "",
    "garbage",
    "1.0.0",
    "1.0.0+build.2",
    "1.1.0",
    "0.99.0-rc.9",
    "1.1.0-01",
    "$(echo injection)"
  ]) {
    assert.equal(selectRegistryMatrix({ latest: "1.0.0", next }).include.length, 3);
  }
});

test("SemVer numeric components are compared numerically without integer truncation", () => {
  for (const next of ["1.10.0-rc.1", "2.0.0-alpha", "9007199254740993.0.0-rc.1"]) {
    assert.equal(selectRegistryMatrix({ latest: "1.9.0", next }).include.length, 6);
  }
  assert.equal(selectRegistryMatrix({ latest: "1.10.0", next: "1.9.9-rc.99" }).include.length, 3);
});

test("invalid latest fails explicitly instead of skipping all coverage", () => {
  for (const latest of [undefined, "bad", "1.0.0-rc.1"]) {
    assert.throws(() => selectRegistryMatrix({ latest }));
  }
});

test("manual exact version or channel replaces automatic selection", () => {
  for (const version of ["1.0.0-rc.2", "1.0.0", "next", "latest"]) {
    const matrix = selectRegistryMatrix(undefined, version);
    assert.equal(matrix.include.length, 3);
    assert.ok(matrix.include.every((entry) => entry.version === version));
  }
});

test("manual selection rejects shell input, npm specs, options, and multiline output", () => {
  for (const value of [
    "$(echo pwned)",
    "`echo pwned`",
    "--registry",
    "@scope/pkg",
    "1.0.0\nkey=value",
    "1.0.0 || whoami",
    "https://example.com/pkg.tgz"
  ]) {
    assert.throws(() => selectRegistryMatrix(undefined, value));
  }
});
