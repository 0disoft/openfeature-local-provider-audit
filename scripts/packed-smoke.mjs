import { exec, execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const ROOT = process.cwd();
const PACKAGE_NAME = "@0disoft/openfeature-local-provider";
const STRICT_CONSUMER_TYPESCRIPT_VERSION = "5.9.3";
const MAX_PACKED_TARBALL_BYTES = 1_048_576;
const PUBLIC_TYPE_EXPORTS = [
  "AuditContextKeyMode",
  "AuditEvent",
  "AuditQueueOverflowPolicy",
  "AuditRedactionOptions",
  "AuditSink",
  "AuditWriteMode",
  "CreateAuditEventOptions",
  "CreateEnvOverridesOptions",
  "EnvOverrideState",
  "EnvSource",
  "EvaluationContext",
  "EvaluationReason",
  "EvaluationRequest",
  "EvaluationResult",
  "EvaluationSource",
  "FileAuditSinkOptions",
  "FileAuditSinkStats",
  "FlagDefinition",
  "FlagSnapshot",
  "FlagSnapshotFileWatcher",
  "FlagType",
  "FlagValue",
  "JsonObject",
  "JsonValue",
  "LoadFlagSnapshotFileOptions",
  "LocalProviderError",
  "LocalProviderErrorCode",
  "LocalProviderOptions",
  "PercentageRolloutRule",
  "RedactedAuditContext",
  "ReloadableLocalProvider",
  "ReplayExpectedResult",
  "ReplayFixture",
  "ReplayMismatch",
  "ReplayOverrideInput",
  "ReplayResult",
  "SnapshotFileFormat",
  "WatchFlagSnapshotFileOptions"
];

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
  const nodeTypesSpec = requirePinnedDependency(rootPackageJson, "@types/node");
  const latestTypescriptSpec = requirePinnedDependency(rootPackageJson, "typescript");
  const tarballPath = await resolveTarballPath(packDirectory);
  const tarballBytes = (await stat(tarballPath)).size;
  if (tarballBytes > MAX_PACKED_TARBALL_BYTES) {
    throw new Error(
      `Packed tarball is ${tarballBytes} bytes, exceeding the ${MAX_PACKED_TARBALL_BYTES}-byte release budget.`
    );
  }

  await writeFile(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "packed-consumer", version: "0.0.0", private: true }, null, 2)}\n`,
    "utf8"
  );
  await run(
    "pnpm",
    [
      "add",
      "--save-exact",
      tarballPath,
      `@openfeature/server-sdk@${openFeatureServerSdkSpec}`,
      `@types/node@${nodeTypesSpec}`,
      `typescript@${STRICT_CONSUMER_TYPESCRIPT_VERSION}`
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
    path.join(consumerDirectory, "runtime-contract.cjs"),
    createRuntimeContractSource(),
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "esm-smoke.mjs"),
    `import { ProviderEvents } from "@openfeature/server-sdk";
import * as provider from "${PACKAGE_NAME}";
import exerciseRuntimeContract from "./runtime-contract.cjs";

await exerciseRuntimeContract(provider, ProviderEvents, "ESM", "audit-esm.jsonl");
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "cjs-smoke.cjs"),
    `const { ProviderEvents } = require("@openfeature/server-sdk");
const provider = require("${PACKAGE_NAME}");
const exerciseRuntimeContract = require("./runtime-contract.cjs");

exerciseRuntimeContract(provider, ProviderEvents, "CJS", "audit-cjs.jsonl").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "typed-smoke.mts"),
    createTypedConsumerSource("esm"),
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "typed-smoke.cts"),
    createTypedConsumerSource("cjs"),
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "tsconfig.strict.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
          types: ["node"]
        },
        files: ["typed-smoke.mts", "typed-smoke.cts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "tsconfig.latest.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: ["node"]
        },
        files: ["typed-smoke.mts", "typed-smoke.cts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await run("pnpm", ["exec", "tsc", "-p", "tsconfig.strict.json"], consumerDirectory);
  await run(
    "pnpm",
    ["exec", "tsc", "-p", path.join(consumerDirectory, "tsconfig.latest.json")],
    ROOT
  );
  await run("node", ["esm-smoke.mjs"], consumerDirectory);
  await run("node", ["cjs-smoke.cjs"], consumerDirectory);
  const { stdout } = await run(
    "pnpm",
    ["exec", "openfeature-local-provider", "validate", "flags.yaml", "--json"],
    consumerDirectory
  );
  const cliResult = JSON.parse(stdout);
  if (cliResult.ok !== true || cliResult.format !== "yaml" || cliResult.flags !== 1) {
    throw new Error(`CLI packed smoke returned an unexpected result: ${stdout}`);
  }

  console.log(
    `Packed smoke passed for ${packageJson.name}@${packageJson.version} (${tarballBytes} bytes) with TypeScript ${STRICT_CONSUMER_TYPESCRIPT_VERSION} (full library check) and ${latestTypescriptSpec} (consumer surface check).`
  );
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function createRuntimeContractSource() {
  return `const { readFile } = require("node:fs/promises");

const EXPECTED_RUNTIME_EXPORTS = ${JSON.stringify(
    [
      "EVALUATION_REASONS",
      "EVALUATION_SOURCES",
      "LOCAL_PROVIDER_ERROR_CODES",
      "LocalProviderError",
      "createAuditEvent",
      "createEnvOverrides",
      "createFileAuditSink",
      "createLocalProvider",
      "createReloadableLocalProvider",
      "evaluateFlag",
      "isLocalProviderError",
      "loadFlagSnapshotFile",
      "parseJsonFlagSnapshot",
      "parseYamlFlagSnapshot",
      "redactContext",
      "replayEvaluationFixture",
      "serializeAuditEvent",
      "watchFlagSnapshotFile"
    ],
    null,
    2
  )};

module.exports = async function exerciseRuntimeContract(api, ProviderEvents, moduleKind, auditPath) {
  const actualExports = Object.keys(api).sort();
  if (JSON.stringify(actualExports) !== JSON.stringify(EXPECTED_RUNTIME_EXPORTS)) {
    throw new Error(moduleKind + " runtime exports drifted: " + JSON.stringify(actualExports));
  }

  const jsonSnapshot = api.parseJsonFlagSnapshot(JSON.stringify({
    schemaVersion: 1,
    flags: {
      "checkout.enabled": {
        type: "boolean",
        defaultVariant: "on",
        variants: { on: true, off: false }
      }
    }
  }));
  const yamlSnapshot = api.parseYamlFlagSnapshot(await readFile("flags.yaml", "utf8"));
  const loadedSnapshot = await api.loadFlagSnapshotFile("flags.yaml");
  if (
    jsonSnapshot.flags["checkout.enabled"].variants.on !== true ||
    yamlSnapshot.flags["checkout.enabled"].variants.on !== true ||
    loadedSnapshot.flags["checkout.enabled"].variants.on !== true
  ) {
    throw new Error(moduleKind + " snapshot parsers or loader returned unexpected data.");
  }

  const overrides = api.createEnvOverrides(jsonSnapshot, { env: {} });
  const request = {
    flagKey: "checkout.enabled",
    defaultValue: false,
    expectedType: "boolean",
    targetingKey: "packed-consumer"
  };
  const result = api.evaluateFlag(jsonSnapshot, { ...request, overrides });
  if (
    result.value !== true ||
    result.reason !== api.EVALUATION_REASONS.STATIC ||
    result.source !== api.EVALUATION_SOURCES.FILE
  ) {
    throw new Error(moduleKind + " evaluator returned an unexpected result.");
  }

  const provider = api.createLocalProvider({ snapshot: jsonSnapshot });
  if (typeof provider.resolveBooleanEvaluation !== "function") {
    throw new Error(moduleKind + " createLocalProvider returned an invalid provider.");
  }

  const reloadableProvider = api.createReloadableLocalProvider({ snapshot: jsonSnapshot });
  let flagsChanged = [];
  reloadableProvider.events?.addHandler(ProviderEvents.ConfigurationChanged, (details) => {
    flagsChanged = details?.flagsChanged ?? [];
  });
  reloadableProvider.updateSnapshot({
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
    throw new Error(moduleKind + " configuration-change keys drifted: " + JSON.stringify(flagsChanged));
  }

  const replay = api.replayEvaluationFixture({
    schemaVersion: 1,
    name: moduleKind.toLowerCase() + "-packed-replay",
    snapshot: jsonSnapshot,
    request,
    expected: {
      value: true,
      variant: "on",
      reason: api.EVALUATION_REASONS.STATIC,
      source: api.EVALUATION_SOURCES.FILE
    }
  });
  if (!replay.passed) {
    throw new Error(moduleKind + " replay fixture did not pass: " + JSON.stringify(replay.mismatches));
  }

  const redactedContext = api.redactContext(
    { email: "synthetic@example.test" },
    { contextKeys: "none" }
  );
  if (redactedContext.keyMode !== "none" || redactedContext.keys.length !== 0) {
    throw new Error(moduleKind + " strict audit context redaction drifted.");
  }
  const auditEvent = api.createAuditEvent({
    providerName: "packed-consumer",
    snapshot: jsonSnapshot,
    request: { ...request, context: { email: "synthetic@example.test" } },
    result,
    eventId: moduleKind.toLowerCase() + "-event",
    timestamp: "2026-01-01T00:00:00.000Z",
    redaction: { contextKeys: "none" }
  });
  const serializedAuditEvent = JSON.parse(api.serializeAuditEvent(auditEvent));
  if (serializedAuditEvent.eventId !== moduleKind.toLowerCase() + "-event") {
    throw new Error(moduleKind + " audit serialization drifted.");
  }
  const auditSink = api.createFileAuditSink({ path: auditPath, maxQueueSize: 8 });
  await auditSink.write(auditEvent);
  await auditSink.flush?.();
  if (auditSink.getStats?.().pendingWrites !== 0) {
    throw new Error(moduleKind + " file audit sink did not flush.");
  }

  const localError = new api.LocalProviderError(
    api.LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR,
    "synthetic packed-consumer error"
  );
  if (!api.isLocalProviderError(localError) || localError.code !== "PARSE_ERROR") {
    throw new Error(moduleKind + " local provider error contract drifted.");
  }

  const watcher = await api.watchFlagSnapshotFile({
    path: "flags.yaml",
    consistencyPollIntervalMs: 50,
    onSnapshot() {}
  });
  watcher.close();
  await provider.onClose?.();
  await reloadableProvider.onClose?.();
};
`;
}

function createTypedConsumerSource(moduleKind) {
  const valueImport =
    moduleKind === "esm"
      ? `import { createLocalProvider } from "${PACKAGE_NAME}";`
      : `import providerPackage = require("${PACKAGE_NAME}");`;
  const createProvider =
    moduleKind === "esm"
      ? "createLocalProvider({ snapshot })"
      : "providerPackage.createLocalProvider({ snapshot })";

  return `${valueImport}
import type {
  ${PUBLIC_TYPE_EXPORTS.join(",\n  ")}
} from "${PACKAGE_NAME}";

type PublicTypeSurface = readonly [
  ${PUBLIC_TYPE_EXPORTS.join(",\n  ")}
];

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
const request: EvaluationRequest<boolean> = {
  flagKey: "checkout.enabled",
  defaultValue: false,
  expectedType: "boolean"
};
const provider = ${createProvider};
const providerName: string = provider.metadata.name;
const publicTypeSurface: PublicTypeSurface | undefined = undefined;

void request;
void providerName;
void publicTypeSurface;
`;
}

function requirePinnedDependency(rootPackageJson, name) {
  const spec = rootPackageJson.devDependencies?.[name];
  if (typeof spec !== "string" || spec.length === 0) {
    throw new Error(`Packed smoke could not resolve the pinned ${name} version.`);
  }
  return spec;
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

  await run("pnpm", ["--filter", PACKAGE_NAME, "build"], ROOT);
  await run("pnpm", ["--filter", PACKAGE_NAME, "pack", "--pack-destination", packDirectory], ROOT);

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
