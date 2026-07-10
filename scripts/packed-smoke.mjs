import { exec, execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const ROOT = process.cwd();

const tempDirectory = await mkdtemp(path.join(tmpdir(), "openfeature-local-provider-packed-"));
const packageDirectory = path.join(ROOT, "packages", "local-provider");
const packDirectory = path.join(tempDirectory, "pack");
const consumerDirectory = path.join(tempDirectory, "consumer");

try {
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });

  await run("pnpm", ["--filter", "@0disoft/openfeature-local-provider", "build"], ROOT);
  await run(
    "pnpm",
    [
      "--filter",
      "@0disoft/openfeature-local-provider",
      "pack",
      "--pack-destination",
      packDirectory
    ],
    ROOT
  );

  const tarball = (await readdir(packDirectory)).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) {
    throw new Error("Packed smoke could not find a generated package tarball.");
  }

  await run("npm", ["init", "-y"], consumerDirectory);
  await run(
    "npm",
    ["install", path.join(packDirectory, tarball), "@openfeature/server-sdk@1.22.0"],
    consumerDirectory
  );

  await writeFile(
    path.join(consumerDirectory, "flags.yaml"),
    `schemaVersion: 1
flags:
  checkout.enabled:
    type: boolean
    defaultVariant: "on"
    variants:
      "on": true
      "off": false
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "esm-smoke.mjs"),
    `import { parseYamlFlagSnapshot, redactContext } from "@0disoft/openfeature-local-provider";
const snapshot = parseYamlFlagSnapshot(await import("node:fs/promises").then(({ readFile }) => readFile("flags.yaml", "utf8")));
if (snapshot.flags["checkout.enabled"].variants.on !== true) {
  throw new Error("ESM import did not evaluate the packed package correctly.");
}
const redactedContext = redactContext({ email: "synthetic@example.test" }, { contextKeys: "none" });
if (redactedContext.keyMode !== "none" || redactedContext.keys.length !== 0) {
  throw new Error("ESM import did not expose strict audit context redaction.");
}
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "cjs-smoke.cjs"),
    `const provider = require("@0disoft/openfeature-local-provider");
if (typeof provider.createLocalProvider !== "function") {
  throw new Error("CJS require did not expose createLocalProvider.");
}
`,
    "utf8"
  );

  await run("node", ["esm-smoke.mjs"], consumerDirectory);
  await run("node", ["cjs-smoke.cjs"], consumerDirectory);
  const { stdout } = await run(
    "npx",
    ["openfeature-local-provider", "validate", "flags.yaml", "--json"],
    consumerDirectory
  );
  const cliResult = JSON.parse(stdout);
  if (cliResult.ok !== true || cliResult.format !== "yaml" || cliResult.flags !== 1) {
    throw new Error(`CLI packed smoke returned an unexpected result: ${stdout}`);
  }

  const packageJson = JSON.parse(
    await readFile(path.join(packageDirectory, "package.json"), "utf8")
  );
  console.log(`Packed smoke passed for ${packageJson.name}@${packageJson.version}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

async function run(command, args, cwd) {
  if (process.platform === "win32") {
    return execAsync(quoteCommand([command, ...args]), {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });
  }

  return execFileAsync(command, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  });
}

function quoteCommand(parts) {
  const [command, ...args] = parts;
  return [command, ...args.map((part) => `"${part.replaceAll('"', '\\"')}"`)].join(" ");
}
