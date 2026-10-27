import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_VERIFY_ATTEMPTS = 36;
const DEFAULT_VERIFY_DELAY_MS = 5_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 180_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;
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
  if (candidateSha256 !== registrySha256) {
    throw new Error(
      `Published tarball SHA-256 mismatch: candidate ${candidateSha256}, registry ${registrySha256}.`
    );
  }
  if (rootMetadata["dist-tags"]?.[expectedTag] !== version) {
    throw new RegistryReadError(
      `npm dist-tag ${expectedTag} does not resolve to ${version} for ${packageName}.`,
      true
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
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS
}) {
  assertNonEmptyString(packageName, "packageName");
  assertNonEmptyString(version, "version");
  assertFetch(fetchImpl);

  assertBoundedInteger(timeoutMs, "timeoutMs", 1, 60_000);
  return boundedRead(
    timeoutMs,
    signal,
    new RegistryReadError("Registry version probe timed out.", true),
    async (readSignal) => {
      const encodedName = encodeURIComponent(packageName);
      const response = await registryRequest(
        `${normalizeRegistryBase(registryBaseUrl)}/${encodedName}/${encodeURIComponent(version)}`,
        { headers: { accept: "application/json" }, signal: readSignal },
        fetchImpl
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return false;
      }
      if (!response.ok) {
        await rejectHttp(response, "version metadata");
      }
      await parseJsonResponse(response, "version metadata", readSignal);
      return true;
    }
  );
}

export async function fetchRegistryRelease({
  packageName,
  version,
  expectedTag,
  candidateSha256,
  registryBaseUrl = DEFAULT_REGISTRY,
  fetchImpl = globalThis.fetch,
  signal
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
    "version metadata",
    signal
  );
  const rootMetadata = await fetchJson(
    `${registryBase}/${encodedName}`,
    fetchImpl,
    "package metadata",
    signal
  );
  const tarballUrl = versionMetadata?.dist?.tarball;
  if (typeof tarballUrl !== "string" || tarballUrl === "") {
    throw new Error(`Registry metadata for ${packageName}@${version} is missing dist.tarball.`);
  }
  const tarballResponse = await registryRequest(
    tarballUrl,
    {
      headers: { accept: "application/octet-stream" },
      signal
    },
    fetchImpl
  );
  if (!tarballResponse.ok) {
    await rejectHttp(tarballResponse, "Registry tarball");
  }
  const tarball = Buffer.from(await readBody(() => tarballResponse.arrayBuffer(), signal));
  signal?.throwIfAborted();
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
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
  signal,
  nowImpl = () => performance.now(),
  ...releaseOptions
}) {
  assertBoundedInteger(attempts, "attempts", 1, 120);
  assertBoundedInteger(delayMs, "delayMs", 0, 60_000);
  assertBoundedInteger(timeoutMs, "timeoutMs", 1, 300_000);
  assertBoundedInteger(attemptTimeoutMs, "attemptTimeoutMs", 1, 60_000);
  if (typeof nowImpl !== "function") throw new TypeError("nowImpl must be a function.");
  if (typeof delayImpl !== "function") {
    throw new TypeError("delayImpl must be a function.");
  }

  let lastError;
  const expired = new RegistryReadError(
    "Registry verification deadline expired; publication may already be complete. Reconcile using read-only verification, not another publish."
  );
  try {
    return await boundedRead(
      timeoutMs,
      signal,
      expired,
      async (readSignal, checkDeadline) => {
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          checkDeadline();
          try {
            return await boundedRead(
              attemptTimeoutMs,
              readSignal,
              new RegistryReadError("Registry read attempt timed out.", true),
              (attemptSignal) => fetchRegistryRelease({ ...releaseOptions, signal: attemptSignal }),
              nowImpl
            );
          } catch (error) {
            checkDeadline();
            lastError = error;
            if (!(error instanceof RegistryReadError) || !error.retryable) throw error;
            if (attempt === attempts) {
              break;
            }
            await delayImpl(Math.max(delayMs, error.retryAfterMs ?? 0), undefined, {
              signal: readSignal
            });
          }
        }
        throw new Error(
          `Registry release verification failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          { cause: lastError }
        );
      },
      nowImpl
    );
  } catch (error) {
    if (error === expired && lastError !== undefined) expired.cause = lastError;
    throw error;
  }
}

export async function fetchJson(
  url,
  fetchImpl = globalThis.fetch,
  label = "registry metadata",
  signal
) {
  assertFetch(fetchImpl);
  const response = await registryRequest(
    url,
    { headers: { accept: "application/json" }, signal },
    fetchImpl
  );
  if (!response.ok) {
    await rejectHttp(response, label);
  }
  return parseJsonResponse(response, label, signal);
}

class RegistryReadError extends Error {
  constructor(message, retryable = false, options) {
    super(message, options);
    this.retryable = retryable;
  }
}

async function registryRequest(url, options, fetchImpl) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new TypeError("Registry reads require HTTP(S).");
  options.signal?.throwIfAborted();
  try {
    const response = await fetchImpl(url, { ...options, method: "GET" });
    if (options.signal?.aborted) {
      await response.body?.cancel();
      options.signal.throwIfAborted();
    }
    return response;
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new RegistryReadError("Registry read transport failed.", true, { cause: error });
  }
}

async function rejectHttp(response, label) {
  const status = response.status;
  const error = new RegistryReadError(
    `${label} request failed with HTTP ${status}.`,
    [404, 408, 425, 429].includes(status) || (status >= 500 && status <= 599)
  );
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const wait = /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - Date.now();
    if (!Number.isNaN(wait)) error.retryAfterMs = Math.min(300_000, Math.max(0, wait));
  }
  try {
    await response.body?.cancel();
  } catch (cleanup) {
    const failure = new RegistryReadError(error.message, error.retryable, {
      cause: new AggregateError([error, cleanup], "Registry response cleanup failed.", {
        cause: error
      })
    });
    failure.retryAfterMs = error.retryAfterMs;
    throw failure;
  }
  throw error;
}

async function readBody(operation, signal) {
  signal?.throwIfAborted();
  try {
    const result = await operation();
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof SyntaxError) throw error;
    throw new RegistryReadError("Registry response body transport failed.", true, { cause: error });
  }
}

async function boundedRead(
  timeoutMs,
  signal,
  expired,
  operation,
  nowImpl = () => performance.now()
) {
  signal?.throwIfAborted();
  const started = nowImpl(),
    controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const check = () => {
    combined.throwIfAborted();
    if (nowImpl() - started >= timeoutMs) {
      controller.abort(expired);
      throw expired;
    }
  };
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(combined.reason);
  });
  combined.addEventListener("abort", rejectAbort, { once: true });
  const timer = setTimeout(() => controller.abort(expired), timeoutMs);
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        check();
        return operation(combined, check);
      }),
      aborted
    ]);
    check();
    return result;
  } catch (error) {
    check();
    throw error;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", rejectAbort);
  }
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
      "--delay-ms",
      "--timeout-ms",
      "--attempt-timeout-ms"
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
      delayMs: parseIntegerOption(options, "--delay-ms", DEFAULT_VERIFY_DELAY_MS),
      timeoutMs: parseIntegerOption(options, "--timeout-ms", DEFAULT_VERIFY_TIMEOUT_MS),
      attemptTimeoutMs: parseIntegerOption(
        options,
        "--attempt-timeout-ms",
        DEFAULT_ATTEMPT_TIMEOUT_MS
      )
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

async function parseJsonResponse(response, label, signal) {
  try {
    return await readBody(() => response.json(), signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof RegistryReadError) throw error;
    throw new Error(`${label} response was not valid JSON: ${error.message}`, { cause: error });
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

function assertBoundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${label} must be an integer from ${min} through ${max}.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await main(process.argv.slice(2));
}
