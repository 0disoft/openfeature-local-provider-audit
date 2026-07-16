import { exec, execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

  const packageJson = JSON.parse(
    await readFile(path.join(packageDirectory, "package.json"), "utf8")
  );
  const rootPackageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const openFeatureServerSdkSpec = resolveOpenFeatureServerSdkSpec(packageJson);
  const nodeTypesSpec = rootPackageJson.devDependencies?.["@types/node"];
  if (typeof nodeTypesSpec !== "string" || nodeTypesSpec.length === 0) {
    throw new Error("Packed smoke could not resolve the pinned @types/node version.");
  }

  const tarballPath = await resolveTarballPath(packDirectory);

  await run("npm", ["init", "-y"], consumerDirectory);
  await run(
    "npm",
    [
      "install",
      tarballPath,
      `@openfeature/server-sdk@${openFeatureServerSdkSpec}`,
      `@types/node@${nodeTypesSpec}`
    ],
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
    `import { ProviderEvents } from "@openfeature/server-sdk";
import { createReloadableLocalProvider, parseYamlFlagSnapshot, redactContext, watchFlagSnapshotFile } from "@0disoft/openfeature-local-provider";
const snapshot = parseYamlFlagSnapshot(await import("node:fs/promises").then(({ readFile }) => readFile("flags.yaml", "utf8")));
if (snapshot.flags["checkout.enabled"].variants.on !== true) {
  throw new Error("ESM import did not evaluate the packed package correctly.");
}
const redactedContext = redactContext({ email: "synthetic@example.test" }, { contextKeys: "none" });
if (redactedContext.keyMode !== "none" || redactedContext.keys.length !== 0) {
  throw new Error("ESM import did not expose strict audit context redaction.");
}
const provider = createReloadableLocalProvider({ snapshot });
let flagsChanged = [];
provider.events?.addHandler(ProviderEvents.ConfigurationChanged, (details) => {
  flagsChanged = details?.flagsChanged ?? [];
});
provider.updateSnapshot({
  schemaVersion: 1,
  flags: {
    "checkout.enabled": {
      type: "boolean",
      defaultVariant: "off",
      variants: { on: true, off: false }
    },
    "checkout.added": {
      type: "boolean",
      defaultVariant: "on",
      variants: { on: true, off: false }
    }
  }
});
if (JSON.stringify(flagsChanged) !== JSON.stringify(["checkout.added", "checkout.enabled"])) {
  throw new Error("Unexpected configuration-change keys: " + JSON.stringify(flagsChanged));
}
const watcher = await watchFlagSnapshotFile({
  path: "flags.yaml",
  consistencyPollIntervalMs: 50,
  onSnapshot() {}
});
watcher.close();
await provider.onClose?.();
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "cjs-smoke.cjs"),
    `const provider = require("@0disoft/openfeature-local-provider");
if (typeof provider.createLocalProvider !== "function") {
  throw new Error("CJS require did not expose createLocalProvider.");
}
if (typeof provider.watchFlagSnapshotFile !== "function") {
  throw new Error("CJS require did not expose watchFlagSnapshotFile.");
}
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "typed-smoke.mts"),
    `import { createLocalProvider, type FlagSnapshot, type WatchFlagSnapshotFileOptions } from "@0disoft/openfeature-local-provider";

const snapshot: FlagSnapshot = {
  schemaVersion: 1,
  flags: {
    "checkout.enabled": {
      type: "boolean",
      defaultVariant: "on",
      variants: { on: true, off: false }
    }
  }
};

const provider = createLocalProvider({ snapshot });
const providerName: string = provider.metadata.name;
const watchOptions: WatchFlagSnapshotFileOptions = {
  path: "flags.yaml",
  consistencyPollIntervalMs: 50,
  onSnapshot() {}
};
void providerName;
void watchOptions;
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: ["node"]
        },
        files: ["typed-smoke.mts"]
      },
      null,
      2
    ),
    "utf8"
  );

  await run("pnpm", ["exec", "tsc", "-p", path.join(consumerDirectory, "tsconfig.json")], ROOT);
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

  console.log(`Packed smoke passed for ${packageJson.name}@${packageJson.version}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function resolveOpenFeatureServerSdkSpec(packageJson) {
  const configuredSpec = process.env.OPENFEATURE_SERVER_SDK_VERSION?.trim();
  if (configuredSpec === undefined || configuredSpec.length === 0) {
    return "1.22.0";
  }
  if (configuredSpec !== "peer") {
    return configuredSpec;
  }

  const peerSpec = packageJson.peerDependencies?.["@openfeature/server-sdk"];
  if (typeof peerSpec !== "string" || peerSpec.length === 0) {
    throw new Error("Packed smoke could not resolve the OpenFeature server SDK peer range.");
  }
  return peerSpec;
}

async function resolveTarballPath(packDirectory) {
  const configuredTarball = process.env.PACKED_SMOKE_TARBALL?.trim();
  if (configuredTarball !== undefined && configuredTarball.length > 0) {
    const tarballPath = path.resolve(ROOT, configuredTarball);
    await access(tarballPath);
    return tarballPath;
  }

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
  return path.join(packDirectory, tarball);
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
