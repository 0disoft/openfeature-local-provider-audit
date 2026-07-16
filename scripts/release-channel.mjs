import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function resolveReleaseChannel(version) {
  const match = typeof version === "string" ? SEMVER_PATTERN.exec(version) : null;
  if (match === null) {
    throw new Error(`Invalid release version: ${String(version)}`);
  }

  const prereleaseIdentifier = match[4];
  if (
    prereleaseIdentifier
      ?.split(".")
      .some(
        (identifier) =>
          /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")
      )
  ) {
    throw new Error(`Invalid release version: ${version}`);
  }

  const prerelease = prereleaseIdentifier !== undefined;
  return {
    version,
    npmTag: prerelease ? "next" : "latest",
    githubPrerelease: prerelease
  };
}

async function main(args) {
  let version;
  let githubOutput;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--version") {
      version = requireOptionValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--github-output") {
      githubOutput = requireOptionValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new Error(`Unknown release-channel argument: ${argument}`);
  }

  const channel = resolveReleaseChannel(version);
  if (githubOutput !== undefined) {
    await appendFile(
      githubOutput,
      `npm-tag=${channel.npmTag}\ngithub-prerelease=${String(channel.githubPrerelease)}\n`,
      "utf8"
    );
  }
  console.log(JSON.stringify(channel));
}

function requireOptionValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  await main(process.argv.slice(2));
}
