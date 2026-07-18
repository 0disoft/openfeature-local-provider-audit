import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_VERIFY_ATTEMPTS = 12;
const DEFAULT_VERIFY_DELAY_MS = 5_000;
const MINIMUM_TRUSTED_PUBLISHING_NPM = "11.5.1";

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertTrustedPublishingNpmVersion(
  version,
  minimum = MINIMUM_TRUSTED_PUBLISHING_NPM
) {
  const actualParts = parseNumericVersion(version, "npm version");
  const minimumParts = parseNumericVersion(minimum, "minimum npm version");
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) {
      return version;
    }
    if (actualParts[index] < minimumParts[index]) {
      throw new Error(
        `npm ${version} does not support trusted publishing; npm ${minimum} or newer is required.`
      );
    }
  }
  return version;
}

export function validateRegistryRelease({
  packageName,
  version,
  expectedTag,
  candidateSha256,
  registrySha256,
  versionMetadata,
  rootMetadata
}) {
  assertNonEmptyString(packageName, "packageName");
  assertNonEmptyString(version, "version");
  assertNonEmptyString(expectedTag, "expectedTag");
  assertSha256(candidateSha256, "candidateSha256");
  assertSha256(registrySha256, "registrySha256");
  assertObject(versionMetadata, "version metadata");
  assertObject(rootMetadata, "root metadata");

  if (versionMetadata.version !== version) {
    throw new Error(
      `Registry metadata version mismatch for ${packageName}: expected ${version}, got ${String(versionMetadata.version)}.`
    );
  }
  if (typeof versionMetadata.dist?.tarball !== "string" || versionMetadata.dist.tarball === "") {
    throw new Error(`Registry metadata for ${packageName}@${version} is missing dist.tarball.`);
  }
  if (rootMetadata["dist-tags"]?.[expectedTag] !== version) {
    throw new Error(
      `npm dist-tag ${expectedTag} does not resolve to ${version} for ${packageName}.`
    );
  }
  if (candidateSha256 !== registrySha256) {
    throw new Error(
      `Published tarball SHA-256 mismatch: candidate ${candidateSha256}, registry ${registrySha256}.`
    );
  }

  return {
    packageName,
    version,
    npmTag: expectedTag,
    tarballUrl: versionMetadata.dist.tarball,
    sha256: registrySha256
  };
}

export async function probeRegistryVersion({
  packageName,
  version,
  registryBaseUrl = DEFAULT_REGISTRY,
  fetchImpl = globalThis.fetch
}) {
  assertNonEmptyString(packageName, "packageName");
  assertNonEmptyString(version, "version");
  assertFetch(fetchImpl);

  const encodedName = encodeURIComponent(packageName);
  const response = await fetchImpl(
    `${normalizeRegistryBase(registryBaseUrl)}/${encodedName}/${encodeURIComponent(version)}`,
    { headers: { accept: "application/json" } }
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`version metadata request failed with HTTP ${response.status}.`);
  }
  await parseJsonResponse(response, "version metadata");
  return true;
}

export async function fetchRegistryRelease({
  packageName,
  version,
  expectedTag,
  candidateSha256,
  registryBaseUrl = DEFAULT_REGISTRY,
  fetchImpl = globalThis.fetch
}) {
  assertNonEmptyString(packageName, "packageName");
  assertNonEmptyString(version, "version");
  assertNonEmptyString(expectedTag, "expectedTag");
  assertSha256(candidateSha256, "candidateSha256");
  assertFetch(fetchImpl);

  const registryBase = normalizeRegistryBase(registryBaseUrl);
  const encodedName = encodeURIComponent(packageName);
  const versionMetadata = await fetchJson(
    `${registryBase}/${encodedName}/${encodeURIComponent(version)}`,
    fetchImpl,
    "version metadata"
  );
  const rootMetadata = await fetchJson(
    `${registryBase}/${encodedName}`,
    fetchImpl,
    "package metadata"
  );
  const tarballUrl = versionMetadata?.dist?.tarball;
  if (typeof tarballUrl !== "string" || tarballUrl === "") {
    throw new Error(`Registry metadata for ${packageName}@${version} is missing dist.tarball.`);
  }
  const tarballResponse = await fetchImpl(tarballUrl, {
    headers: { accept: "application/octet-stream" }
  });
  if (!tarballResponse.ok) {
    throw new Error(`Registry tarball request failed with HTTP ${tarballResponse.status}.`);
  }
  const tarball = Buffer.from(await tarballResponse.arrayBuffer());
  const registrySha256 = sha256Bytes(tarball);
  const release = validateRegistryRelease({
    packageName,
    version,
    expectedTag,
    candidateSha256,
    registrySha256,
    versionMetadata,
    rootMetadata
  });
  return { ...release, tarball };
}

export async function verifyRegistryReleaseWithRetry({
  attempts = DEFAULT_VERIFY_ATTEMPTS,
  delayMs = DEFAULT_VERIFY_DELAY_MS,
  delayImpl = delay,
  ...releaseOptions
}) {
  assertPositiveInteger(attempts, "attempts");
  assertNonNegativeInteger(delayMs, "delayMs");
  if (typeof delayImpl !== "function") {
    throw new TypeError("delayImpl must be a function.");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchRegistryRelease(releaseOptions);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await delayImpl(delayMs);
    }
  }
  throw new Error(
    `Registry release verification failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError }
  );
}

export async function fetchJson(url, fetchImpl = globalThis.fetch, label = "registry metadata") {
  assertFetch(fetchImpl);
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}.`);
  }
  return parseJsonResponse(response, label);
}

async function main(args) {
  const [command, ...rawOptions] = args;
  const options = parseOptions(rawOptions);

  if (command === "candidate") {
    const tarball = requireOption(options, "--tarball", command);
    const githubOutput = requireOption(options, "--github-output", command);
    const bundleTool = requireOption(options, "--bundle-tool", command);
    rejectUnknownOptions(options, ["--tarball", "--github-output", "--bundle-tool"]);
    const digest = sha256Bytes(await readFile(resolve(tarball)));
    await copyFile(new URL(import.meta.url), resolve(bundleTool));
    await writeGithubOutput(githubOutput, { "candidate-sha256": digest });
    console.log(JSON.stringify({ candidateSha256: digest, bundledTool: resolve(bundleTool) }));
    return;
  }

  if (command === "npm-version") {
    rejectUnknownOptions(options, []);
    const result = spawnSync("npm", ["--version"], { encoding: "utf8" });
    if (result.error) {
      throw new Error(`Unable to execute npm --version: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`npm --version failed with exit code ${String(result.status)}.`);
    }
    const version = result.stdout.trim();
    assertTrustedPublishingNpmVersion(version);
    console.log(JSON.stringify({ npmVersion: version, minimum: MINIMUM_TRUSTED_PUBLISHING_NPM }));
    return;
  }

  if (command === "probe") {
    const packageName = requireOption(options, "--package", command);
    const version = requireOption(options, "--version", command);
    const githubOutput = requireOption(options, "--github-output", command);
    rejectUnknownOptions(options, ["--package", "--version", "--github-output", "--registry"]);
    const published = await probeRegistryVersion({
      packageName,
      version,
      registryBaseUrl: options.get("--registry")
    });
    await writeGithubOutput(githubOutput, { published: String(published) });
    console.log(JSON.stringify({ packageName, version, published }));
    return;
  }

  if (command === "verify") {
    const packageName = requireOption(options, "--package", command);
    const version = requireOption(options, "--version", command);
    const expectedTag = requireOption(options, "--expected-tag", command);
    const candidate = resolve(requireOption(options, "--candidate", command));
    const expectedSha256 = requireOption(options, "--expected-sha256", command);
    const outputDirectory = resolve(requireOption(options, "--output-dir", command));
    const githubOutput = requireOption(options, "--github-output", command);
    rejectUnknownOptions(options, [
      "--package",
      "--version",
      "--expected-tag",
      "--candidate",
      "--expected-sha256",
      "--output-dir",
      "--github-output",
      "--registry",
      "--attempts",
      "--delay-ms"
    ]);

    const candidateSha256 = sha256Bytes(await readFile(candidate));
    if (candidateSha256 !== expectedSha256) {
      throw new Error(
        `Downloaded candidate SHA-256 mismatch: expected ${expectedSha256}, got ${candidateSha256}.`
      );
    }
    const release = await verifyRegistryReleaseWithRetry({
      packageName,
      version,
      expectedTag,
      candidateSha256,
      registryBaseUrl: options.get("--registry"),
      attempts: parseIntegerOption(options, "--attempts", DEFAULT_VERIFY_ATTEMPTS),
      delayMs: parseIntegerOption(options, "--delay-ms", DEFAULT_VERIFY_DELAY_MS)
    });
    await mkdir(outputDirectory, { recursive: true });
    const registryTarball = resolve(outputDirectory, basename(candidate));
    await writeFile(registryTarball, release.tarball);
    await writeGithubOutput(githubOutput, {
      "registry-tarball": registryTarball,
      "registry-sha256": release.sha256
    });
    console.log(
      JSON.stringify({
        packageName,
        version,
        npmTag: release.npmTag,
        registryTarball,
        registrySha256: release.sha256
      })
    );
    return;
  }

  throw new Error(`Unknown registry-release command: ${String(command)}`);
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (typeof option !== "string" || !option.startsWith("--")) {
      throw new Error(`Expected an option, got ${String(option)}.`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    if (options.has(option)) {
      throw new Error(`Duplicate registry-release option: ${option}`);
    }
    options.set(option, value);
  }
  return options;
}

function requireOption(options, name, command) {
  const value = options.get(name);
  if (value === undefined) {
    throw new Error(`${command} requires ${name}.`);
  }
  return value;
}

function rejectUnknownOptions(options, allowed) {
  const allowedSet = new Set(allowed);
  for (const option of options.keys()) {
    if (!allowedSet.has(option)) {
      throw new Error(`Unknown registry-release option: ${option}`);
    }
  }
}

function parseIntegerOption(options, name, fallback) {
  const value = options.get(name);
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return Number.parseInt(value, 10);
}

async function writeGithubOutput(filePath, values) {
  const lines = Object.entries(values)
    .map(([name, value]) => `${name}=${value}\n`)
    .join("");
  await appendFile(filePath, lines, "utf8");
}

async function parseJsonResponse(response, label) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} response was not valid JSON: ${error.message}`);
  }
}

function normalizeRegistryBase(value) {
  const registryBase = value ?? DEFAULT_REGISTRY;
  assertNonEmptyString(registryBase, "registryBaseUrl");
  return registryBase.replace(/\/+$/, "");
}

function parseNumericVersion(value, label) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new TypeError(`${label} must contain exactly three numeric components.`);
  }
  return value.split(".").map((part) => Number.parseInt(part, 10));
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertFetch(value) {
  if (typeof value !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await main(process.argv.slice(2));
}
