import { exec, execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
const V2_TYPE_EXPORTS = new Set([
  "FileSnapshotStoreOptions",
  "SnapshotRecovery",
  "SignedSnapshotStore",
  "SignFlagSnapshotOptions",
  "SnapshotVerificationOptions",
  "SignedSnapshotMetadata",
  "VerifiedFlagSnapshot",
  "SnapshotVerifier",
  "SnapshotSource",
  "SnapshotSourceRequest",
  "SnapshotSourceResponse",
  "HttpsSnapshotSourceOptions",
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
  "FileSnapshotStoreOptions",
  "SnapshotRecovery",
  "SignedSnapshotStore",
  "SignFlagSnapshotOptions",
  "SnapshotVerificationOptions",
  "SignedSnapshotMetadata",
  "VerifiedFlagSnapshot",
  "SnapshotVerifier",
  "SnapshotSource",
  "SnapshotSourceRequest",
  "SnapshotSourceResponse",
  "HttpsSnapshotSourceOptions",
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
    parseRegistryVersion(process.argv.slice(2))
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
            "createSnapshotRefresher",
            "signFlagSnapshot",
            "createSnapshotVerifier",
            "createFileSnapshotStore"
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
    const callbacks = new Set();
    const metrics = api.createOpenTelemetryMetrics({
      createCounter(name) { return { add(value, attributes) { measurements.push({ name, value, attributes }); } }; },
      createHistogram(name) { return { record(value, attributes) { measurements.push({ name, value, attributes }); } }; },
      createObservableGauge(name) {
        return {
          addCallback(callback) { callbacks.add(callback); },
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
        async writeConfirmed() { throw new Error("expected storage failure"); }
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
    if (callbacks.size !== 1 || !measurements.some((metric) =>
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
    offlineProvider.updateSnapshot(jsonSnapshot);
    if (offlineProvider.getStatus().provenance !== undefined || signedRefresher.getProvenance() !== undefined) {
      throw new Error(moduleKind + " unsigned update retained signed origin");
    }
    const recoveryStore = api.createFileSnapshotStore({ path: auditPath + ".snapshots", verification: {
      audience: "packed", trustedKeys: { packed: signingKeys.publicKey }
    } });
    await recoveryStore.commit(Buffer.from(signed));
    const recoveredSnapshot = await api.createFileSnapshotStore({ path: auditPath + ".snapshots", verification: {
      audience: "packed", trustedKeys: { packed: signingKeys.publicKey }
    } }).load();
    if (recoveredSnapshot?.floor.artifactHash !== signedResult.provenance.artifactHash ||
        recoveredSnapshot?.current?.snapshot.schemaVersion !== jsonSnapshot.schemaVersion || recoveredSnapshot.history.length !== 1) {
      throw new Error(moduleKind + " signed recovery contract failed");
    }
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
      ? `import { createLocalProvider } from "${PACKAGE_NAME}";`
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
declare const recoveryStore: SignedSnapshotStore;
const recoveryPromise: Promise<SnapshotRecovery | undefined> = recoveryStore.load();
const storeOptions: FileSnapshotStoreOptions = {
  path: "caller-owned-state.json", verification: { trustedKeys: {}, audience: "typed" }, maxHistory: 5
};
const refreshOptions: SnapshotRefresherOptions = {
  provider: reloadable, source: { async fetch() { return { status: "notModified" }; } },
  ...(origin ? { previous: origin } : {})
};
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
