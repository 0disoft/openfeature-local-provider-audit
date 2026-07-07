#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { runCli } from "./cli/run.js";

async function main(): Promise<number> {
  const packageVersion = await readPackageVersion();
  return runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    packageVersion,
    stderr(text) {
      process.stderr.write(text);
    },
    stdout(text) {
      process.stdout.write(text);
    }
  });
}

async function readPackageVersion(): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
);
