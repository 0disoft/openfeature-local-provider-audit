import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseChannel } from "./release-channel.mjs";

const PLATFORMS = ["ubuntu-latest", "windows-latest", "macos-15"];
const PACKAGE_NAME = "@0disoft/openfeature-local-provider";

function parseVersion(value) {
  resolveReleaseChannel(value);
  const [core, prerelease] = value.split("+")[0].split(/-(.*)/s);
  return { core: core.split(".").map(BigInt), prerelease: prerelease?.split(".") };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease || !b.prerelease) {
    return Number(!a.prerelease) - Number(!b.prerelease);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function selectRegistryMatrix(tags, requestedVersion = "") {
  if (requestedVersion !== "") {
    // Only exact versions and dist-tag names are accepted, never npm specs or options.
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(requestedVersion)) {
      resolveReleaseChannel(requestedVersion);
    }
    return {
      include: PLATFORMS.map((os) => ({ os, channel: requestedVersion, version: requestedVersion }))
    };
  }
  const latest = tags?.latest;
  if (resolveReleaseChannel(latest).githubPrerelease) {
    throw new Error("The latest dist-tag must resolve to a stable version.");
  }
  const versions = [{ channel: "latest", version: latest }];
  const next = tags?.next;
  let activeNext = false;
  try {
    activeNext = resolveReleaseChannel(next).githubPrerelease && compareVersions(next, latest) > 0;
  } catch {
    // Missing or malformed optional next tags do not suppress the stable checks.
  }
  if (activeNext) versions.push({ channel: "next", version: next });
  return { include: versions.flatMap((entry) => PLATFORMS.map((os) => ({ os, ...entry }))) };
}

async function main() {
  const requestedVersion = process.env.REGISTRY_SMOKE_VERSION ?? "";
  let tags;
  if (requestedVersion === "") {
    const response = await fetch(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(PACKAGE_NAME)}/dist-tags`,
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) throw new Error(`npm dist-tags request failed: HTTP ${response.status}`);
    tags = await response.json();
  }
  const matrix = selectRegistryMatrix(tags, requestedVersion);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`, "utf8");
  }
  console.log(JSON.stringify(matrix));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
