import { exec, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const ROOT = process.cwd();
const reuseBuild = process.argv[2] === "--reuse-build";
const PACKAGE_NAME = "@0disoft/openfeature-local-provider";
const STRICT_CONSUMER_TYPESCRIPT_VERSION = "5.9.3";
const MAX_PACKED_TARBALL_BYTES = 1_048_576;
const V2_TYPE_EXPORTS = new Set([
  "SnapshotExpiryPolicy",
  "ExportAuditEvidenceOptions",
  "AuditEvidenceFile",
  "AuditEvidenceExport",
  "ScheduledRollout",
  "ScheduleEvaluation",
  "AuditPseudonym",
  "AuditPseudonymizer",
  "HmacAuditPseudonymizerOptions",
  "FileSnapshotStoreOptions",
  "SnapshotRecovery",
  "SignedSnapshotStore",
  "SnapshotUpdateTransaction",
  "AuditChainCheckpoint",
  "ChainedAuditEvent",
  "AuditChainOptions",
  "VerifyAuditChainOptions",
  "AuditChainVerification",
  "ChainedFileAuditSinkOptions",
  "AuditChainFileCheckpoint",
  "ChainedFileAuditSink",
  "SignFlagSnapshotOptions",
  "SnapshotVerificationOptions",
  "SignedSnapshotMetadata",
  "VerifiedFlagSnapshot",
  "SnapshotVerifier",
  "SnapshotSource",
  "SnapshotSourceRequest",
  "SnapshotSourceResponse",
  "HttpsSnapshotSourceOptions",
  "S3SnapshotClient",
  "S3SnapshotSourceOptions",
  "SnapshotRefresherOptions",
  "SnapshotRefreshResult",
  "SnapshotRefresher",
  "OpenTelemetryMeter",
  "ProviderMetrics",
  "ProviderMetricsSession",
  "ProviderEvaluationMetric",
  "AuditFailurePolicy",
  "ObservableLocalProvider",
  "ProviderStatus",
  "ProviderAuditStatus",
  "RefreshFailureKind",
  "ConditionScalar",
  "TargetingCondition",
  "TargetingRule",
  "EvaluationExplanation",
  "RuleExplanation"
]);
const PUBLIC_TYPE_EXPORTS = [
  "SnapshotExpiryPolicy",
  "ExportAuditEvidenceOptions",
  "AuditEvidenceFile",
  "AuditEvidenceExport",
  "ScheduledRollout",
  "ScheduleEvaluation",
  "AuditPseudonym",
  "AuditPseudonymizer",
  "HmacAuditPseudonymizerOptions",
  "FileSnapshotStoreOptions",
  "SnapshotRecovery",
  "SignedSnapshotStore",
  "SnapshotUpdateTransaction",
  "AuditChainCheckpoint",
  "ChainedAuditEvent",
  "AuditChainOptions",
  "VerifyAuditChainOptions",
  "AuditChainVerification",
  "ChainedFileAuditSinkOptions",
  "AuditChainFileCheckpoint",
  "ChainedFileAuditSink",
  "SignFlagSnapshotOptions",
  "SnapshotVerificationOptions",
  "SignedSnapshotMetadata",
  "VerifiedFlagSnapshot",
  "SnapshotVerifier",
  "SnapshotSource",
  "SnapshotSourceRequest",
  "SnapshotSourceResponse",
  "HttpsSnapshotSourceOptions",
  "S3SnapshotClient",
  "S3SnapshotSourceOptions",
  "SnapshotRefresherOptions",
  "SnapshotRefreshResult",
  "SnapshotRefresher",
  "OpenTelemetryMeter",
  "ProviderMetrics",
  "ProviderMetricsSession",
  "ProviderEvaluationMetric",
  "AuditFailurePolicy",
  "ObservableLocalProvider",
  "ProviderStatus",
  "ProviderAuditStatus",
  "RefreshFailureKind",
  "EvaluationExplanation",
  "RuleExplanation",
  "ConditionScalar",
  "TargetingCondition",
  "TargetingRule",
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
  const nodeTypesSpec = await requireInstalledDependencyVersion(rootPackageJson, "@types/node");
  const latestTypescriptSpec = await requireInstalledDependencyVersion(
    rootPackageJson,
    "typescript"
  );
  const installTarget = await resolveInstallTarget(
    packDirectory,
    packageJson,
    parseRegistryVersion(process.argv.slice(reuseBuild ? 3 : 2))
  );

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
      installTarget.spec,
      `@openfeature/server-sdk@${openFeatureServerSdkSpec}`,
      `@types/node@${nodeTypesSpec}`,
      `typescript@${STRICT_CONSUMER_TYPESCRIPT_VERSION}`
    ],
    consumerDirectory
  );

  const installedPackageJson = JSON.parse(
    await readFile(
      path.join(
        consumerDirectory,
        "node_modules",
        "@0disoft",
        "openfeature-local-provider",
        "package.json"
      ),
      "utf8"
    )
  );
  if (
    installedPackageJson.name !== PACKAGE_NAME ||
    installedPackageJson.version !== installTarget.version
  ) {
    throw new Error(
      `Consumer installed ${String(installedPackageJson.name)}@${String(installedPackageJson.version)}, expected ${PACKAGE_NAME}@${installTarget.version}.`
    );
  }

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
    createRuntimeContractSource(Number(installTarget.version.split(".")[0]) >= 2),
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "esm-smoke.mjs"),
    `import { ProviderEvents } from "@openfeature/server-sdk";
import * as provider from "${PACKAGE_NAME}";
import exerciseRuntimeContract from "./runtime-contract.cjs";

${
  installTarget.source === "packed"
    ? `const { readFile } = await import("node:fs/promises");
for (const version of [1, 2]) {
  const schema = JSON.parse(await readFile(new URL(import.meta.resolve("${PACKAGE_NAME}/schemas/v" + version + ".json")), "utf8"));
  if (schema.properties.schemaVersion.const !== version) throw new Error("Packaged schema version mismatch");
}
`
    : ""
}
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
    createTypedConsumerSource("esm", Number(installTarget.version.split(".")[0]) >= 2),
    "utf8"
  );
  await writeFile(
    path.join(consumerDirectory, "typed-smoke.cts"),
    createTypedConsumerSource("cjs", Number(installTarget.version.split(".")[0]) >= 2),
    "utf8"
  );
  if (installTarget.source === "packed") {
    await writeFile(
      path.join(consumerDirectory, "type-flags.json"),
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          "checkout.enabled": { type: "boolean", variants: { on: true }, defaultVariant: "on" },
          data: {
            type: "object",
            variants: { configured: { private: "not-emitted" } },
            defaultVariant: "configured"
          }
        }
      })
    );
    const generated = await run(
      "pnpm",
      ["exec", "openfeature-local-provider", "generate-types", "type-flags.json"],
      consumerDirectory
    );
    if (generated.stdout.includes("not-emitted"))
      throw new Error("Generated types exposed variant values");
    await writeFile(path.join(consumerDirectory, "flags.generated.d.ts"), generated.stdout, "utf8");
    await writeFile(
      path.join(consumerDirectory, "typed-generated.mts"),
      `import type { FlagKey, FlagValue } from "./flags.generated.js";
const key: FlagKey = "checkout.enabled";
const fallback: FlagValue<typeof key> = false;
const objectOverride: FlagValue<"data"> = { unconfigured: [null, false, 1] };
const arrayOverride: FlagValue<"data"> = [null, { value: "new" }];
// @ts-expect-error unknown flag must fail
const unknown: FlagKey = "missing";
// @ts-expect-error incorrect value type must fail
const wrong: FlagValue<"checkout.enabled"> = "true";
void [key, fallback, objectOverride, arrayOverride, unknown, wrong];
`,
      "utf8"
    );
  }
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
        files: [
          "typed-smoke.mts",
          "typed-smoke.cts",
          ...(installTarget.source === "packed" ? ["typed-generated.mts"] : [])
        ]
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
        files: [
          "typed-smoke.mts",
          "typed-smoke.cts",
          ...(installTarget.source === "packed" ? ["typed-generated.mts"] : [])
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (installedPackageJson.exports?.["./core"] !== undefined) {
    await copyFile(
      path.join(ROOT, "examples/core-basic/index.mjs"),
      path.join(consumerDirectory, "core-example.mjs")
    );
    const exampleRun = JSON.parse(
      (await run("node", ["core-example.mjs"], consumerDirectory)).stdout
    );
    if (
      exampleRun.cohortSize !== 200 ||
      exampleRun.internalPreview !== "TARGETING_MATCH" ||
      exampleRun.emergencyStop !== "DISABLED" ||
      exampleRun.stages?.[2]?.enabled !== 200
    ) {
      throw new Error("Packed core adoption example failed.");
    }
    await access(
      path.join(
        consumerDirectory,
        "node_modules",
        "@0disoft",
        "openfeature-local-provider",
        "THIRD_PARTY_NOTICES"
      )
    );
    await writeFile(
      path.join(consumerDirectory, "core-smoke.mjs"),
      `
import * as core from "${PACKAGE_NAME}/core";
import * as native from "${PACKAGE_NAME}";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const cjs = createRequire(import.meta.url)("${PACKAGE_NAME}/core");
const snapshot = core.parseJsonFlagSnapshot(JSON.stringify({schemaVersion:2,flags:{feature:{type:"boolean",defaultVariant:"off",variants:{on:true,off:false},schedule:{variant:"on",seed:"한국어",stages:[{at:10,percentage:50},{at:20,percentage:100}]}}}}));
assert.deepEqual(Object.keys(core).sort(), ["EVALUATION_REASONS","EVALUATION_SOURCES","LOCAL_PROVIDER_ERROR_CODES","LocalProviderError","evaluateFlag","isLocalProviderError","parseJsonFlagSnapshot"].sort());
for (let index=0;index<200;index++) {
  const request={flagKey:"feature",expectedType:"boolean",defaultValue:false,targetingKey:"😀"+index,evaluationTime:index%30};
  const expected=native.evaluateFlag(snapshot,request);
  assert.deepEqual(core.evaluateFlag(snapshot,request),expected);
  assert.deepEqual(cjs.evaluateFlag(snapshot,request),expected);
}
`,
      "utf8"
    );
    await writeFile(
      path.join(consumerDirectory, "core-types.mts"),
      `
import { evaluateFlag, parseJsonFlagSnapshot, type FlagSnapshot, type EvaluationRequest, type EvaluationResult } from "${PACKAGE_NAME}/core";
const snapshot: FlagSnapshot = parseJsonFlagSnapshot('{"schemaVersion":1,"flags":{}}');
const request: EvaluationRequest<boolean> = {flagKey:"missing",expectedType:"boolean",defaultValue:false};
const result: EvaluationResult<boolean> = evaluateFlag(snapshot,request);
void result;
`,
      "utf8"
    );
    await writeFile(
      path.join(consumerDirectory, "tsconfig.core.json"),
      JSON.stringify({
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
          lib: ["ES2022"],
          types: []
        },
        files: ["core-types.mts"]
      }),
      "utf8"
    );
    await run("pnpm", ["exec", "tsc", "-p", "tsconfig.core.json"], consumerDirectory);
    await run(
      "pnpm",
      ["exec", "tsc", "-p", path.join(consumerDirectory, "tsconfig.core.json")],
      ROOT
    );
    await run("node", ["core-smoke.mjs"], consumerDirectory);
  }

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

  if (Number(installTarget.version.split(".")[0]) >= 2) {
    const targeted = {
      schemaVersion: 2,
      flags: {
        enabled: {
          type: "boolean",
          defaultVariant: "off",
          variants: { on: true, off: false },
          rules: [
            {
              id: "pilot",
              when: { attribute: ["tenant"], op: "eq", value: "pilot" },
              variant: "on"
            }
          ]
        }
      }
    };
    await writeFile(
      path.join(consumerDirectory, "flagd-static.json"),
      JSON.stringify({
        flags: {
          enabled: { state: "ENABLED", variants: { on: true, off: false }, defaultVariant: "off" }
        }
      })
    );
    const importedPlan = await run(
      "pnpm",
      ["exec", "openfeature-local-provider", "import-flagd", "flagd-static.json"],
      consumerDirectory
    );
    if (JSON.parse(importedPlan.stdout).flagCount !== 1)
      throw new Error("Packed flagd plan failed");
    const imported = await run(
      "pnpm",
      [
        "exec",
        "openfeature-local-provider",
        "import-flagd",
        "flagd-static.json",
        "--emit-snapshot"
      ],
      consumerDirectory
    );
    await writeFile(path.join(consumerDirectory, "imported.json"), imported.stdout);
    const checkedImport = await run(
      "pnpm",
      ["exec", "openfeature-local-provider", "validate", "imported.json", "--json"],
      consumerDirectory
    );
    if (JSON.parse(checkedImport.stdout).ok !== true)
      throw new Error("Packed flagd output failed validation");
    const stopped = {
      schemaVersion: 2,
      flags: { enabled: { ...targeted.flags.enabled, disabledVariant: "off" } }
    };
    const request = {
      flagKey: "enabled",
      expectedType: "boolean",
      defaultValue: false,
      context: { tenant: "pilot", private: "must-not-appear" }
    };
    for (const [file, value] of Object.entries({
      "targeted.json": targeted,
      "stopped.json": stopped,
      "request.json": request,
      "requests.json": [request, request]
    })) {
      await writeFile(path.join(consumerDirectory, file), JSON.stringify(value));
    }
    for (const [command, args] of [
      ["evaluate", ["targeted.json", "--request", "request.json"]],
      ["simulate", ["targeted.json", "--requests", "requests.json"]],
      ["compare", ["targeted.json", "stopped.json", "--requests", "requests.json"]]
    ]) {
      const { stdout } = await run(
        "pnpm",
        ["exec", "openfeature-local-provider", command, ...args],
        consumerDirectory
      );
      const result = JSON.parse(stdout);
      if (
        stdout.includes("must-not-appear") ||
        (command === "evaluate" && (result.ruleId !== "pilot" || result.value !== undefined)) ||
        (command === "simulate" && (result.total !== 2 || result.groups[0]?.count !== 2)) ||
        (command === "compare" && result.changedValues !== 2)
      )
        throw new Error(`Packed ${command} contract failed`);
    }
  }

  if (installTarget.source === "registry") {
    console.log(
      JSON.stringify(
        {
          result: "registry-consumer-smoke-passed",
          package: `${packageJson.name}@${installTarget.version}`,
          source: installTarget.source,
          requestedVersion: installTarget.requestedVersion,
          tarballBytes: installTarget.tarballBytes,
          sha256: installTarget.sha256,
          integrity: installTarget.integrity,
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
          openFeatureServerSdk: openFeatureServerSdkSpec,
          strictTypeScript: STRICT_CONSUMER_TYPESCRIPT_VERSION,
          consumerSurfaceTypeScript: latestTypescriptSpec
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `Packed smoke passed for ${packageJson.name}@${packageJson.version} (${installTarget.tarballBytes} bytes) on Node.js ${process.version} (${process.platform}-${process.arch}) with TypeScript ${STRICT_CONSUMER_TYPESCRIPT_VERSION} (full library check) and ${latestTypescriptSpec} (consumer surface check).`
    );
  }
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function createRuntimeContractSource(targeting) {
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
      ...(targeting
        ? [
            "explainEvaluation",
            "createOpenTelemetryMetrics",
            "createHttpsSnapshotSource",
            "createS3SnapshotSource",
            "createSnapshotRefresher",
            "createManagedLocalProvider",
            "createWatchedLocalProvider",
            "signFlagSnapshot",
            "createSnapshotVerifier",
            "createFileSnapshotStore",
            "createAuditChainCheckpoint",
            "createChainedAuditEvent",
            "verifyAuditChainRecord",
            "verifyAuditChain",
            "createChainedFileAuditSink",
            "exportChainedAuditEvidence",
            "createHmacAuditPseudonymizer"
          ]
        : []),
      "isLocalProviderError",
      "loadFlagSnapshotFile",
      "parseJsonFlagSnapshot",
      "parseYamlFlagSnapshot",
      "redactContext",
      "replayEvaluationFixture",
      "serializeAuditEvent",
      "watchFlagSnapshotFile"
    ].sort(),
    null,
    2
  )};

module.exports = async function exerciseRuntimeContract(api, ProviderEvents, moduleKind, auditPath) {
  const actualExports = Object.keys(api).sort();
  if (JSON.stringify(actualExports) !== JSON.stringify(EXPECTED_RUNTIME_EXPORTS)) {
    throw new Error(moduleKind + " runtime exports drifted: " + JSON.stringify(actualExports));
  }

  if (${targeting}) {
    const snapshot = api.parseJsonFlagSnapshot(JSON.stringify({ schemaVersion: 2, flags: { targeted: { type: "boolean", defaultVariant: "off", variants: { on: true, off: false }, rules: [{ id: "pilot", when: { attribute: ["appVersion"], op: "semverGte", value: "2.0.0" }, variant: "on" }] } } }));
    const request = { flagKey: "targeted", expectedType: "boolean", defaultValue: false, context: { appVersion: "2.1.0", private: "must-not-appear" } };
    const actual = api.evaluateFlag(snapshot, request);
    for (const op of ["startsWith", "endsWith"]) {
      const literalSnapshot = api.parseJsonFlagSnapshot(JSON.stringify({ schemaVersion: 2, flags: { text: {
        type: "boolean", variants: { on: true, off: false }, defaultVariant: "off",
        rules: [{ id: "literal", when: { attribute: ["tenant"], op, value: "😀" }, variant: "on" }]
      } } }));
      if (!api.evaluateFlag(literalSnapshot, { flagKey: "text", expectedType: "boolean", defaultValue: false, context: { tenant: "😀" } }).value)
        throw new Error(moduleKind + " literal string targeting failed");
    }
    const explanation = api.explainEvaluation(snapshot, request);
    if (actual.value !== true || actual.ruleId !== "pilot" || explanation.ruleId !== "pilot" || JSON.stringify(explanation).includes("must-not-appear")) throw new Error(moduleKind + " v2 targeting/explanation failed");
    const replay = api.replayEvaluationFixture({ schemaVersion: 1, name: "targeting", snapshot, request, expected: { value: true, variant: "on", ruleId: "pilot", reason: "TARGETING_MATCH", source: "file" } });
    if (!replay.passed) throw new Error(moduleKind + " v2 replay failed");
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
  if (${targeting}) {
    const initial = reloadableProvider.getStatus();
    reloadableProvider.reportRefreshFailure("load");
    reloadableProvider.updateSnapshot(jsonSnapshot);
    const recovered = reloadableProvider.getStatus();
    if (typeof provider.getStatus !== "function" || initial.successfulRefreshes !== 1 ||
        recovered.failedRefreshes !== 1 || recovered.consecutiveRefreshFailures !== 0 ||
        recovered.snapshotHash !== initial.snapshotHash || !Object.isFrozen(recovered.audit)) {
      throw new Error(moduleKind + " operational status contract failed");
    }
    const measurements = [];
    const callbacks = new Map();
    const metrics = api.createOpenTelemetryMetrics({
      createCounter(name) { return { add(value, attributes) { measurements.push({ name, value, attributes }); } }; },
      createHistogram(name) { return { record(value, attributes) { measurements.push({ name, value, attributes }); } }; },
      createObservableGauge(name, options) {
        return {
          addCallback(callback) { callbacks.set(callback, { name, unit: options?.unit }); },
          removeCallback(callback) { callbacks.delete(callback); }
        };
      }
    });
    const strictAuditProvider = api.createLocalProvider({
      snapshot: jsonSnapshot,
      env: {},
      metrics,
      auditFailurePolicy: "returnDefault",
      auditSink: {
        async write() { throw new Error("Unconfirmed write must not be selected"); },
        async writeConfirmed() { throw new Error("expected storage failure"); },
        getStats() { return { pendingWrites: 1, droppedWrites: 0, rejectedWrites: 0,
          maxQueueSize: 5, pendingBytes: 7, maxQueueBytes: 64 }; }
      }
    });
    const auditFallback = await strictAuditProvider.resolveBooleanEvaluation(
      "checkout.enabled", false, {}, { debug() {}, info() {}, warn() {}, error() {} }
    );
    if (auditFallback.value !== false || auditFallback.reason !== "ERROR" ||
        auditFallback.errorCode !== "GENERAL" ||
        strictAuditProvider.getStatus().audit.failedWrites !== 1) {
      throw new Error(moduleKind + " audit failure policy contract failed");
    }
    for (const [callback, instrument] of callbacks) {
      callback({ observe(value, attributes) { measurements.push({ ...instrument, value, attributes }); } });
    }
    if (!measurements.some((metric) => metric.name.endsWith(".audit.queue.bytes") &&
        metric.unit === "By" && metric.attributes.state === "pending" && metric.value === 7) ||
        !measurements.some((metric) => metric.name.endsWith(".audit.queue.bytes") &&
        metric.unit === "By" && metric.attributes.state === "bounded_capacity" && metric.value === 64)) {
      throw new Error(moduleKind + " audit queue bytes contract failed");
    }
    if (callbacks.size !== 2 || !measurements.some((metric) =>
        metric.name.endsWith(".evaluations") && metric.attributes.reason === "ERROR" &&
        metric.attributes.error_code === "AUDIT_SINK_ERROR")) {
      throw new Error(moduleKind + " optional metrics contract failed");
    }
    await strictAuditProvider.onClose();
    if (callbacks.size !== 0) throw new Error(moduleKind + " metrics cleanup failed");
    const offlineProvider = api.createReloadableLocalProvider({ snapshot: jsonSnapshot, env: {} });
    let sourceCalls = 0;
    const refresher = api.createSnapshotRefresher({
      provider: offlineProvider,
      source: {
        async fetch(input) {
          sourceCalls++;
          return input.etag === '"packed"' ? { status: "notModified" } :
            { status: "content", content: Buffer.from(JSON.stringify(jsonSnapshot)), etag: '"packed"' };
        }
      }
    });
    await refresher.refresh();
    await refresher.refresh();
    if (sourceCalls !== 2 || offlineProvider.getStatus().successfulRefreshes !== 3) {
      throw new Error(moduleKind + " source refresh contract failed");
    }
    refresher.close();
    let rejectedInsecure = false;
    try { api.createHttpsSnapshotSource({ url: "http://example.test/flags" }); }
    catch { rejectedInsecure = true; }
    if (!rejectedInsecure) throw new Error(moduleKind + " source HTTPS validation failed");
    const objectSource = api.createS3SnapshotSource({ bucket: "packed", key: "flags.json",
      client: { async getObject(input) {
        if (input.Bucket !== "packed" || input.Key !== "flags.json") throw new Error("object addressing");
        return { Body: require("node:stream").Readable.from([Buffer.from("{}")]), ContentLength: 2, ETag: '"object"' };
      } }
    });
    const objectBytes = await objectSource.fetch();
    if (objectBytes.status !== "content" || Buffer.from(objectBytes.content).toString() !== "{}") throw new Error(moduleKind + " object source failed");
    const signingKeys = require("node:crypto").generateKeyPairSync("ed25519");
    const signed = api.signFlagSnapshot({
      snapshot: jsonSnapshot, privateKey: signingKeys.privateKey, keyId: "packed",
      audience: "packed", sequence: 1, issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60000
    });
    const signedRefresher = api.createSnapshotRefresher({
      provider: offlineProvider,
      source: { async fetch() { return { status: "content", content: Buffer.from(signed) }; } },
      verifier: api.createSnapshotVerifier({ audience: "packed", trustedKeys: { packed: signingKeys.publicKey } })
    });
    const signedResult = await signedRefresher.refresh();
    if (signedResult.provenance?.sequence !== 1 ||
        offlineProvider.getStatus().provenance?.artifactHash !== signedResult.provenance.artifactHash ||
        signedRefresher.getProvenance()?.snapshotHash !== offlineProvider.getStatus().snapshotHash) {
      throw new Error(moduleKind + " signed snapshot/provenance contract failed");
    }
    const signedAudit = api.createAuditEvent({
      providerName: "packed", snapshot: jsonSnapshot, provenance: signedResult.provenance,
      request: { flagKey: "checkout.enabled", defaultValue: false, expectedType: "boolean" },
      result: api.evaluateFlag(jsonSnapshot, { flagKey: "checkout.enabled", defaultValue: false, expectedType: "boolean" })
    });
    if (signedAudit.provenance?.artifactHash !== signedResult.provenance?.artifactHash) {
      throw new Error(moduleKind + " audit artifact linkage failed");
    }
    const expiryLogger = { debug() {}, info() {}, warn() {}, error() {} };
    const expiryOrigin = signedResult.provenance;
    const expiring = api.createLocalProvider({ snapshot: jsonSnapshot, env: {}, provenance: expiryOrigin,
      snapshotExpiryPolicy: "returnDefault", clock: () => expiryOrigin.expiresAt });
    const expiredResolution = await expiring.resolveBooleanEvaluation("checkout.enabled", false, {}, expiryLogger);
    if (expiredResolution.value !== false || expiredResolution.errorCode !== "PROVIDER_NOT_READY")
      throw new Error(moduleKind + " authenticated active snapshot expiry failed");
    await expiring.onClose();
    offlineProvider.updateSnapshot(jsonSnapshot);
    if (offlineProvider.getStatus().provenance !== undefined || signedRefresher.getProvenance() !== undefined) {
      throw new Error(moduleKind + " unsigned update retained signed origin");
    }
    const recoveryStore = api.createFileSnapshotStore({ path: auditPath + ".snapshots", verification: {
      audience: "packed", trustedKeys: { packed: signingKeys.publicKey }
    } });
    const durableProvider = api.createReloadableLocalProvider({ snapshot: jsonSnapshot, env: {} });
    const durableRefresher = api.createSnapshotRefresher({ provider: durableProvider, store: recoveryStore,
      verifier: api.createSnapshotVerifier({ audience: "packed", trustedKeys: { packed: signingKeys.publicKey } }),
      source: { async fetch() { return { status: "content", content: Buffer.from(signed) }; } }
    });
    await durableRefresher.refresh();
    if (durableProvider.getStatus().provenance?.artifactHash !== signedResult.provenance.artifactHash) {
      throw new Error(moduleKind + " durable activation failed");
    }
    durableRefresher.close();
    const recoveredSnapshot = await api.createFileSnapshotStore({ path: auditPath + ".snapshots", verification: {
      audience: "packed", trustedKeys: { packed: signingKeys.publicKey }
    } }).load();
    if (recoveredSnapshot?.floor.artifactHash !== signedResult.provenance.artifactHash ||
        recoveredSnapshot?.current?.snapshot.schemaVersion !== jsonSnapshot.schemaVersion || recoveredSnapshot.history.length !== 1) {
      throw new Error(moduleKind + " signed recovery contract failed");
    }
    const recoveryVerification = auditPath + ".verification.json";
    const recoveryFs = require("node:fs/promises");
    await recoveryFs.writeFile(recoveryVerification, JSON.stringify({ audience: "packed", trustedKeys: {
      packed: signingKeys.publicKey.export({ format: "pem", type: "spki" })
    } }));
    const recoveryBinary = require("node:path").join(process.cwd(), "node_modules", "@0disoft/openfeature-local-provider", "bin", "openfeature-local-provider.js");
    const recoveryBefore = await recoveryFs.readFile(auditPath + ".snapshots");
    const diagnosedRecovery = JSON.parse(require("node:child_process").execFileSync(process.execPath,
      [recoveryBinary, "snapshot-diagnose", auditPath + ".snapshots", "--verification", recoveryVerification], { encoding: "utf8" }));
    if (diagnosedRecovery.status !== "valid" || !diagnosedRecovery.headAuthenticated ||
        !diagnosedRecovery.activationEligible || !recoveryBefore.equals(await recoveryFs.readFile(auditPath + ".snapshots")))
      throw new Error(moduleKind + " read-only recovery diagnosis failed");
    let managedFetches = 0;
    const managed = await api.createManagedLocalProvider({
      source: { async fetch() { managedFetches++; return { status: "content", content: Buffer.from(signed) }; } },
      verification: { audience: "packed", trustedKeys: { packed: signingKeys.publicKey } },
      recovery: { path: auditPath + ".snapshots" }, bootstrap: jsonSnapshot,
      provider: { snapshotExpiryPolicy: "returnDefault", clock: () => expiryOrigin.expiresAt }
    });
    if (managedFetches !== 0 || managed.getStatus().provenance?.artifactHash !== signedResult.provenance.artifactHash) {
      throw new Error(moduleKind + " managed offline recovery failed");
    }
    if ((await managed.provider.resolveBooleanEvaluation("checkout.enabled", false, {}, expiryLogger)).errorCode !== "PROVIDER_NOT_READY")
      throw new Error(moduleKind + " managed recovered snapshot expiry failed");
    await managed.refresh();
    const managedClose = managed.provider.onClose();
    if (managed.close() !== managedClose) throw new Error(moduleKind + " managed close was not shared");
    await managedClose;
    if (!managed.getStatus().closed || managedFetches !== 1) throw new Error(moduleKind + " managed lifecycle failed");
    const watched = await api.createWatchedLocalProvider({ path: "flags.yaml" });
    if (watched.getStatus().successfulRefreshes !== 1) throw new Error(moduleKind + " watched startup duplicated validation");
    await watched.reload();
    if (watched.getStatus().successfulRefreshes !== 2) throw new Error(moduleKind + " watched reload missing");
    const watchedClose = watched.provider.onClose();
    if (watched.close() !== watchedClose) throw new Error(moduleKind + " watched close not shared");
    await watchedClose;
    if (!watched.getStatus().closed) throw new Error(moduleKind + " watched shutdown failed");
    signedRefresher.close();
  }
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
  if (${targeting}) {
    const anchor = api.createAuditChainCheckpoint("packed");
    const scheduledSnapshot = api.parseJsonFlagSnapshot(JSON.stringify({ schemaVersion: 2, flags: { feature: {
      type: "boolean", variants: { on: true, off: false }, defaultVariant: "off",
      schedule: { variant: "on", stages: [{ at: 1000, percentage: 0 }, { at: 2000, percentage: 100 }] }
    } } }));
    const scheduleRequest = { flagKey: "feature", expectedType: "boolean", defaultValue: false, targetingKey: "private-subject", evaluationTime: 2000 };
    const scheduleResult = api.evaluateFlag(scheduledSnapshot, scheduleRequest);
    if (scheduleResult.value !== true || scheduleResult.schedule.stage !== 1 ||
      !api.replayEvaluationFixture({ schemaVersion: 1, name: "schedule", snapshot: scheduledSnapshot, request: scheduleRequest,
        expected: { value: true, variant: "on", bucket: scheduleResult.bucket, reason: "SPLIT", source: "file", schedule: scheduleResult.schedule } }).passed) {
      throw new Error(moduleKind + " scheduled rollout/replay failed");
    }
    const pseudonymizer = api.createHmacAuditPseudonymizer({ key: require("node:crypto").randomBytes(32), keyId: "packed-key", scope: "packed" });
    const pseudonymous = api.createAuditEvent({ providerName: "packed-consumer", snapshot: scheduledSnapshot,
      request: scheduleRequest, result: scheduleResult, pseudonymizer });
    if (pseudonymous.pseudonym.hash !== pseudonymizer.pseudonymize("private-subject").hash || JSON.stringify(pseudonymous).includes("private-subject")) {
      throw new Error(moduleKind + " audit pseudonym contract failed");
    }
    const chained = api.createChainedAuditEvent(pseudonymous, anchor);
    const head = api.verifyAuditChainRecord(chained, anchor);
    if (!api.verifyAuditChain([chained], { start: anchor, expectedHead: head }).checkpointMatched) {
      throw new Error(moduleKind + " audit chain verification failed");
    }
    const chainedSink = api.createChainedFileAuditSink({ directory: auditPath + ".chain-store", chainId: "packed-store", maxSegmentBytes: 1, maxSegments: 2 });
    await chainedSink.write(pseudonymous); await chainedSink.writeConfirmed(pseudonymous); await chainedSink.write(pseudonymous);
    const fileCheckpoint = await chainedSink.getCheckpoint();
    if (fileCheckpoint.start.sequence !== 1 || fileCheckpoint.head.sequence !== 3 || fileCheckpoint.files.length !== 2) {
      throw new Error(moduleKind + " chained file checkpoint failed");
    }
    const fs = require("node:fs/promises");
    const exported = await api.exportChainedAuditEvidence({ directory: auditPath + ".chain-store", destination: auditPath + ".evidence" });
    const receipt = JSON.parse(await fs.readFile(auditPath + ".evidence/evidence.json", "utf8"));
    if (exported.start.sequence !== 1 || exported.head.sequence !== 3 || exported.records !== 2 ||
      exported.checkpointAuthenticated !== false || JSON.stringify(receipt) !== JSON.stringify(exported)) {
      throw new Error(moduleKind + " consistent audit evidence export failed");
    }
    for (const file of exported.files) {
      const bytes = await fs.readFile(auditPath + ".evidence/" + file.name);
      if (bytes.length !== file.bytes || require("node:crypto").createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new Error(moduleKind + " audit evidence inventory mismatch");
      }
    }
    await fs.writeFile(auditPath + ".chain", JSON.stringify(chained) + "\\n");
    await fs.writeFile(auditPath + ".head", JSON.stringify(head));
    const binary = require("node:path").join(process.cwd(), "node_modules", "@0disoft/openfeature-local-provider", "bin", "openfeature-local-provider.js");
    await fs.writeFile(auditPath + ".schedule.json", JSON.stringify(scheduledSnapshot));
    await fs.writeFile(auditPath + ".schedule.request.json", JSON.stringify(scheduleRequest));
    const scheduleExplanation = JSON.parse(require("node:child_process").execFileSync(process.execPath,
      [binary, "explain", auditPath + ".schedule.json", "--request", auditPath + ".schedule.request.json"], { encoding: "utf8" }));
    if (scheduleExplanation.schedule.evaluatedAt !== 2000 || scheduleExplanation.schedule.stage !== 1 || JSON.stringify(scheduleExplanation).includes("private-subject")) {
      throw new Error(moduleKind + " packed scheduled inspection failed");
    }
    const verified = JSON.parse(require("node:child_process").execFileSync(process.execPath,
      [binary, "audit-verify", auditPath + ".chain", "--chain-id", "packed", "--expect-head", auditPath + ".head"], { encoding: "utf8" }));
    if (!verified.checkpointMatched || verified.records !== 1) throw new Error(moduleKind + " packed audit CLI verification failed");
  }
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

function createTypedConsumerSource(moduleKind, targeting) {
  const publicTypeExports = PUBLIC_TYPE_EXPORTS.filter(
    (name) => targeting || !V2_TYPE_EXPORTS.has(name)
  );
  const valueImport =
    moduleKind === "esm"
      ? `import { createLocalProvider${targeting ? ", exportChainedAuditEvidence" : ""} } from "${PACKAGE_NAME}";`
      : `import providerPackage = require("${PACKAGE_NAME}");`;
  const createProvider =
    moduleKind === "esm"
      ? "createLocalProvider({ snapshot })"
      : "providerPackage.createLocalProvider({ snapshot })";

  return `${valueImport}
import type {
  ${publicTypeExports.join(",\n  ")}
} from "${PACKAGE_NAME}";

type PublicTypeSurface = readonly [
  ${publicTypeExports.join(",\n  ")}
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
${
  targeting
    ? `
const observable: ObservableLocalProvider = provider;
const status: ProviderStatus = observable.getStatus();
const auditStatus: ProviderAuditStatus = status.audit;
const failureKind: RefreshFailureKind = "load";
observable.reportRefreshFailure(failureKind);
const failurePolicy: AuditFailurePolicy = "returnDefault";
const confirmedSink: AuditSink = {
  async write() {},
  async writeConfirmed() {}
};
const confirmedOptions: LocalProviderOptions = {
  snapshot, auditSink: confirmedSink, auditFailurePolicy: failurePolicy, auditTimeoutMs: 250
};
const timedOutWrites: number = auditStatus.timedOutWrites;
const origin: SignedSnapshotMetadata | undefined = status.provenance;
const originOptions: LocalProviderOptions = { snapshot, ...(origin ? { provenance: origin } : {}) };
const snapshotExpiryPolicy: SnapshotExpiryPolicy = "returnDefault";
const expiringOptions: LocalProviderOptions = { snapshot, snapshotExpiryPolicy };
void expiringOptions;
declare const reloadable: ReloadableLocalProvider;
reloadable.updateSnapshot(snapshot, origin);
declare const audited: AuditEvent;
const auditOrigin: SignedSnapshotMetadata | undefined = audited.provenance;
const auditOptions: CreateAuditEventOptions = {
  providerName, snapshot, request,
  result: { flagKey: "checkout.enabled", value: true, reason: "STATIC", source: "file", flagMetadata: {} },
  ...(origin ? { provenance: origin } : {})
};
void originOptions;
void auditOrigin;
void auditOptions;
declare const objectClient: S3SnapshotClient;
const objectSourceOptions: S3SnapshotSourceOptions = { client: objectClient, bucket: "typed", key: "flags.json" };
void objectSourceOptions;
declare const recoveryStore: SignedSnapshotStore;
const recoveryPromise: Promise<SnapshotRecovery | undefined> = recoveryStore.load();
const storeOptions: FileSnapshotStoreOptions = {
  path: "caller-owned-state.json", verification: { trustedKeys: {}, audience: "typed" }, maxHistory: 5
};
const refreshOptions: SnapshotRefresherOptions = {
  provider: reloadable, store: recoveryStore, source: { async fetch() { return { status: "notModified" }; } },
  ...(origin ? { previous: origin } : {})
};
if (reloadable.prepareSnapshot !== undefined) {
  const transaction: SnapshotUpdateTransaction = reloadable.prepareSnapshot(snapshot, origin);
  transaction.cancel();
}
declare const chainCheckpoint: AuditChainCheckpoint;
const scheduleOptions: ScheduledRollout = { variant: "on", stages: [{ at: 0, percentage: 100 }] };
const scheduleDecision: ScheduleEvaluation = { evaluatedAt: 0, stage: 0, percentage: 100 };
void scheduleOptions; void scheduleDecision;
declare const pseudonymizer: AuditPseudonymizer;
const pseudonym: AuditPseudonym | undefined = pseudonymizer.pseudonymize("subject");
const pseudonymOptions: HmacAuditPseudonymizerOptions = { key: new Uint8Array(32), keyId: "typed", scope: "typed" };
void pseudonym; void pseudonymOptions;
declare const chainRecord: ChainedAuditEvent;
const chainOptions: AuditChainOptions = { maxRecordBytes: 1024 };
const verifyOptions: VerifyAuditChainOptions = { ...chainOptions, start: chainCheckpoint, expectedHead: chainCheckpoint, maxRecords: 1 };
declare const chainVerification: AuditChainVerification;
const verifiedHead: AuditChainCheckpoint = chainVerification.head;
declare const chainedFileSink: ChainedFileAuditSink;
const fileCheckpointPromise: Promise<AuditChainFileCheckpoint> = chainedFileSink.getCheckpoint();
const chainedFileOptions: ChainedFileAuditSinkOptions = { directory: "caller-owned-audit", chainId: "typed", maxSegments: 5 };
const evidenceOptions: ExportAuditEvidenceOptions = { directory: "caller-owned-audit", destination: "caller-owned-export", maxBytes: 1024, maxRecords: 0, signal: new AbortController().signal };
const evidencePromise: Promise<AuditEvidenceExport> = ${moduleKind === "esm" ? "exportChainedAuditEvidence" : "providerPackage.exportChainedAuditEvidence"}(evidenceOptions);
declare const evidence: AuditEvidenceExport;
const evidenceFile: AuditEvidenceFile | undefined = evidence.files[0];
void evidencePromise; void evidenceFile;
void fileCheckpointPromise; void chainedFileOptions;
void chainRecord; void verifyOptions; void verifiedHead;
void refreshOptions;
void recoveryPromise;
void storeOptions;
void confirmedOptions;
void timedOutWrites;
const sourceRequest: SnapshotSourceRequest = { etag: '"typed"' };
const snapshotSource: SnapshotSource = {
  async fetch(input) {
    return input?.etag ? { status: "notModified" } : { status: "content", content: new Uint8Array() };
  }
};
const sourceResponse: Promise<SnapshotSourceResponse> = snapshotSource.fetch(sourceRequest);
void sourceResponse;
`
    : ""
}

void request;
void providerName;
void publicTypeSurface;
`;
}

async function requireInstalledDependencyVersion(rootPackageJson, name) {
  const spec = rootPackageJson.devDependencies?.[name];
  if (typeof spec !== "string" || spec.length === 0) {
    throw new Error(`Packed smoke could not resolve the ${name} dependency.`);
  }
  const metadata = JSON.parse(
    await readFile(path.join(ROOT, "node_modules", name, "package.json"), "utf8")
  );
  return metadata.version;
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

function parseRegistryVersion(args) {
  if (args.length === 0) {
    return process.env.REGISTRY_SMOKE_VERSION?.trim() || undefined;
  }
  if (args.length !== 2 || args[0] !== "--registry-version" || args[1].length === 0) {
    throw new Error("Usage: packed-smoke.mjs [--registry-version <package|version>]");
  }
  return args[1];
}

async function resolveInstallTarget(packDirectory, packageJson, registryVersion) {
  if (registryVersion !== undefined) {
    if (reuseBuild) throw new Error("--reuse-build cannot be combined with registry smoke.");
    const requestedVersion = registryVersion === "package" ? packageJson.version : registryVersion;
    const metadataResponse = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/${encodeURIComponent(requestedVersion)}`,
      { headers: { accept: "application/json" } }
    );
    if (!metadataResponse.ok) {
      throw new Error(`Registry metadata request failed with HTTP ${metadataResponse.status}.`);
    }
    const metadata = await metadataResponse.json();
    const version = metadata?.version;
    const tarballUrl = metadata?.dist?.tarball;
    if (typeof version !== "string" || typeof tarballUrl !== "string" || tarballUrl === "") {
      throw new Error(`Registry metadata for ${PACKAGE_NAME}@${requestedVersion} is incomplete.`);
    }
    if (registryVersion === "package" && version !== packageJson.version) {
      throw new Error(
        `Registry resolved ${version}, expected current source package version ${packageJson.version}.`
      );
    }
    const tarballResponse = await fetch(tarballUrl, {
      headers: { accept: "application/octet-stream" }
    });
    if (!tarballResponse.ok) {
      throw new Error(`Registry tarball request failed with HTTP ${tarballResponse.status}.`);
    }
    const tarball = Buffer.from(await tarballResponse.arrayBuffer());
    enforceTarballBudget(tarball.length);
    return {
      source: "registry",
      spec: `${PACKAGE_NAME}@${version}`,
      requestedVersion,
      version,
      tarballBytes: tarball.length,
      sha256: createHash("sha256").update(tarball).digest("hex"),
      integrity: typeof metadata.dist.integrity === "string" ? metadata.dist.integrity : null
    };
  }

  const tarballPath = await resolveTarballPath(packDirectory);
  const tarballBytes = (await stat(tarballPath)).size;
  enforceTarballBudget(tarballBytes);
  return {
    source: "packed",
    spec: tarballPath,
    version: packageJson.version,
    tarballBytes,
    sha256: createHash("sha256")
      .update(await readFile(tarballPath))
      .digest("hex"),
    integrity: null
  };
}

function enforceTarballBudget(tarballBytes) {
  if (tarballBytes > MAX_PACKED_TARBALL_BYTES) {
    throw new Error(
      `Packed tarball is ${tarballBytes} bytes, exceeding the ${MAX_PACKED_TARBALL_BYTES}-byte release budget.`
    );
  }
}

async function resolveTarballPath(packDirectory) {
  const configuredTarball = process.env.PACKED_SMOKE_TARBALL?.trim();
  if (configuredTarball !== undefined && configuredTarball.length > 0) {
    const tarballPath = path.resolve(ROOT, configuredTarball);
    await access(tarballPath);
    return tarballPath;
  }

  if (reuseBuild) {
    for (const file of ["index.js", "index.cjs", "index.d.ts", "core.js", "core.cjs", "core.d.ts"])
      await access(path.join(packageDirectory, "dist", file));
  } else {
    await run("pnpm", ["--filter", PACKAGE_NAME, "build"], ROOT);
  }
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
