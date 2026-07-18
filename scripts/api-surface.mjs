import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = process.cwd();
const PACKAGE_JSON = path.join(ROOT, "packages", "local-provider", "package.json");
const IMPORT_DECLARATIONS = path.join(ROOT, "packages", "local-provider", "dist", "index.d.ts");
const REQUIRE_DECLARATIONS = path.join(ROOT, "packages", "local-provider", "dist", "index.d.cts");
const IMPORT_RUNTIME = path.join(ROOT, "packages", "local-provider", "dist", "index.js");
const REQUIRE_RUNTIME = path.join(ROOT, "packages", "local-provider", "dist", "index.cjs");
const BASELINE_METADATA = path.join(ROOT, "api", "local-provider.api.json");
const BASELINE_DECLARATIONS = path.join(ROOT, "api", "local-provider.api.d.ts");
const BASELINE_SCHEMA = "openfeature-local-provider.api-surface/v1";
const require = createRequire(import.meta.url);

export async function analyzeDeclarationFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  const program = ts.createProgram({
    rootNames: [resolvedPath],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022
    }
  });
  const sourceFile = program.getSourceFile(resolvedPath);
  if (sourceFile === undefined) {
    throw new Error(`TypeScript could not load declaration file: ${resolvedPath}`);
  }
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(`Declaration file is not an external module: ${resolvedPath}`);
  }

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((exportSymbol) => describeExport(exportSymbol, sourceFile, checker))
    .sort((left, right) => compareText(left.name, right.name));
}

export function compareDeclarationSurfaces(expected, actual) {
  const expectedByName = new Map(expected.map((entry) => [entry.name, entry]));
  const actualByName = new Map(actual.map((entry) => [entry.name, entry]));
  const changes = [];

  for (const [name, expectedEntry] of expectedByName) {
    const actualEntry = actualByName.get(name);
    if (actualEntry === undefined) {
      changes.push({ kind: "removed", name });
      continue;
    }
    if (JSON.stringify(actualEntry.spaces) !== JSON.stringify(expectedEntry.spaces)) {
      changes.push({
        kind: "changed",
        name,
        detail: `spaces ${JSON.stringify(expectedEntry.spaces)} -> ${JSON.stringify(actualEntry.spaces)}`
      });
      continue;
    }
    if (JSON.stringify(actualEntry.declarations) !== JSON.stringify(expectedEntry.declarations)) {
      changes.push({ kind: "changed", name, detail: "normalized declaration changed" });
    }
  }

  for (const name of actualByName.keys()) {
    if (!expectedByName.has(name)) {
      changes.push({ kind: "added", name });
    }
  }

  return changes.sort((left, right) => compareText(left.name, right.name));
}

export function classifySurfaceChanges(changes) {
  if (changes.some((change) => change.kind === "removed" || change.kind === "changed")) {
    return "breaking";
  }
  if (changes.some((change) => change.kind === "added")) {
    return "additive";
  }
  return "none";
}

export function isVersionSufficient(baselineVersion, currentVersion, classification) {
  if (classification === "none") {
    return true;
  }
  const baseline = parseSemver(baselineVersion);
  const current = parseSemver(currentVersion);
  if (compareSemver(current, baseline) <= 0) {
    return false;
  }
  if (
    baseline.prerelease.length > 0 &&
    current.prerelease.length > 0 &&
    current.major === baseline.major &&
    current.minor === baseline.minor &&
    current.patch === baseline.patch
  ) {
    return true;
  }
  if (baseline.major === 0) {
    return current.major > 0 || (current.major === 0 && current.minor > baseline.minor);
  }
  if (classification === "breaking") {
    return current.major > baseline.major;
  }
  return current.major > baseline.major || current.minor > baseline.minor;
}

async function checkApiSurface() {
  const packageJson = await readJson(PACKAGE_JSON);
  const baselineMetadata = await readJson(BASELINE_METADATA);
  validateBaselineMetadata(baselineMetadata, packageJson.name);

  const baseline = await analyzeDeclarationFile(BASELINE_DECLARATIONS);
  const importSurface = await analyzeDeclarationFile(IMPORT_DECLARATIONS);
  const requireSurface = await analyzeDeclarationFile(REQUIRE_DECLARATIONS);
  const importChanges = compareDeclarationSurfaces(baseline, importSurface);
  const requireChanges = compareDeclarationSurfaces(baseline, requireSurface);
  const declarationChanges = mergeChanges(importChanges, requireChanges);
  const expectedRuntimeExports = valueExportNames(baseline);
  const importRuntimeExports = await readImportRuntimeExports();
  const requireRuntimeExports = readRequireRuntimeExports();
  const runtimeChanges = [
    ...compareRuntimeExports(expectedRuntimeExports, importRuntimeExports, "ESM"),
    ...compareRuntimeExports(expectedRuntimeExports, requireRuntimeExports, "CJS")
  ];
  const classification = classifySurfaceChanges(declarationChanges);

  if (declarationChanges.length > 0 || runtimeChanges.length > 0) {
    const versionSufficient = isVersionSufficient(
      baselineMetadata.version,
      packageJson.version,
      classification
    );
    const details = [
      ...formatDeclarationChanges("import", importChanges),
      ...formatDeclarationChanges("require", requireChanges),
      ...runtimeChanges
    ];
    if (!versionSufficient) {
      details.push(
        `package version ${packageJson.version} does not satisfy the ${classification} API change from baseline ${baselineMetadata.version}`
      );
    }
    throw new Error(`API surface check failed:\n- ${details.join("\n- ")}`);
  }

  if (packageJson.version !== baselineMetadata.version) {
    throw new Error(
      `API surface is unchanged but baseline version ${baselineMetadata.version} does not match package version ${packageJson.version}; rebaseline after release review.`
    );
  }

  console.log(
    `API surface matched ${baselineMetadata.packageName}@${baselineMetadata.version}: ${baseline.length} exports (${expectedRuntimeExports.length} runtime values).`
  );
}

async function writeBaseline() {
  const packageJson = await readJson(PACKAGE_JSON);
  const currentImportSurface = await analyzeDeclarationFile(IMPORT_DECLARATIONS);
  const currentRequireSurface = await analyzeDeclarationFile(REQUIRE_DECLARATIONS);
  const conditionChanges = compareDeclarationSurfaces(currentImportSurface, currentRequireSurface);
  if (conditionChanges.length > 0) {
    throw new Error(
      `Cannot baseline divergent import/require declarations:\n- ${formatDeclarationChanges("require", conditionChanges).join("\n- ")}`
    );
  }

  const expectedRuntimeExports = valueExportNames(currentImportSurface);
  const runtimeChanges = [
    ...compareRuntimeExports(expectedRuntimeExports, await readImportRuntimeExports(), "ESM"),
    ...compareRuntimeExports(expectedRuntimeExports, readRequireRuntimeExports(), "CJS")
  ];
  if (runtimeChanges.length > 0) {
    throw new Error(`Cannot baseline runtime/declaration drift:\n- ${runtimeChanges.join("\n- ")}`);
  }

  const previousMetadata = await readJson(BASELINE_METADATA).catch(() => undefined);
  if (previousMetadata !== undefined) {
    validateBaselineMetadata(previousMetadata, packageJson.name);
    const previousSurface = await analyzeDeclarationFile(BASELINE_DECLARATIONS);
    const changes = compareDeclarationSurfaces(previousSurface, currentImportSurface);
    const classification = classifySurfaceChanges(changes);
    if (!isVersionSufficient(previousMetadata.version, packageJson.version, classification)) {
      throw new Error(
        `Refusing to rebaseline ${classification} API changes without a sufficient version change from ${previousMetadata.version} to ${packageJson.version}.`
      );
    }
  }

  await writeFile(BASELINE_DECLARATIONS, await readFile(IMPORT_DECLARATIONS, "utf8"), "utf8");
  await writeFile(
    BASELINE_METADATA,
    `${JSON.stringify(
      {
        schemaVersion: BASELINE_SCHEMA,
        packageName: packageJson.name,
        version: packageJson.version,
        declarations: "local-provider.api.d.ts"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`Updated API baseline for ${packageJson.name}@${packageJson.version}.`);
}

function describeExport(exportSymbol, sourceFile, checker) {
  const target = resolveAlias(exportSymbol, checker);
  const spaces = [];
  if ((target.flags & ts.SymbolFlags.Type) !== 0) {
    spaces.push("type");
  }
  if ((target.flags & ts.SymbolFlags.Value) !== 0) {
    spaces.push("value");
  }
  return {
    name: exportSymbol.getName(),
    spaces,
    declarations: collectNormalizedDeclarations(target, sourceFile, checker)
  };
}

function collectNormalizedDeclarations(rootSymbol, sourceFile, checker) {
  const declarations = new Set();
  const queued = [...(rootSymbol.declarations ?? [])];

  while (queued.length > 0) {
    const declaration = queued.shift();
    if (
      declaration === undefined ||
      declaration.getSourceFile() !== sourceFile ||
      declarations.has(declaration)
    ) {
      continue;
    }
    declarations.add(declaration);
    visitIdentifiers(declaration, (identifier) => {
      const symbol = checker.getSymbolAtLocation(identifier);
      if (symbol === undefined) {
        return;
      }
      const target = resolveAlias(symbol, checker);
      for (const dependency of target.declarations ?? []) {
        if (dependency.getSourceFile() === sourceFile && !declarations.has(dependency)) {
          queued.push(dependency);
        }
      }
    });
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
  return [...declarations]
    .map((declaration) =>
      normalizePrintedDeclaration(
        printer.printNode(ts.EmitHint.Unspecified, declaration, sourceFile)
      )
    )
    .sort(compareText);
}

function normalizePrintedDeclaration(value) {
  return value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}

function visitIdentifiers(node, visitor) {
  if (ts.isIdentifier(node)) {
    visitor(node);
  }
  ts.forEachChild(node, (child) => visitIdentifiers(child, visitor));
}

function resolveAlias(symbol, checker) {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

function valueExportNames(surface) {
  return surface
    .filter((entry) => entry.spaces.includes("value"))
    .map((entry) => entry.name)
    .sort(compareText);
}

async function readImportRuntimeExports() {
  const module = await import(
    `${pathToFileURL(IMPORT_RUNTIME).href}?api-surface-check=${Date.now()}`
  );
  return Object.keys(module).sort(compareText);
}

function readRequireRuntimeExports() {
  delete require.cache[require.resolve(REQUIRE_RUNTIME)];
  return Object.keys(require(REQUIRE_RUNTIME)).sort(compareText);
}

function compareRuntimeExports(expected, actual, moduleKind) {
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : [
        `${moduleKind} runtime exports ${JSON.stringify(actual)} do not match ${JSON.stringify(expected)}`
      ];
}

function mergeChanges(...changeGroups) {
  const changes = new Map();
  for (const change of changeGroups.flat()) {
    const key = `${change.kind}:${change.name}:${change.detail ?? ""}`;
    changes.set(key, change);
  }
  return [...changes.values()];
}

function formatDeclarationChanges(condition, changes) {
  return changes.map(
    (change) =>
      `${condition} declaration ${change.kind} ${change.name}${change.detail === undefined ? "" : ` (${change.detail})`}`
  );
}

function validateBaselineMetadata(metadata, packageName) {
  if (metadata.schemaVersion !== BASELINE_SCHEMA) {
    throw new Error(`Unsupported API baseline schema: ${String(metadata.schemaVersion)}`);
  }
  if (metadata.packageName !== packageName) {
    throw new Error(
      `API baseline package ${String(metadata.packageName)} does not match package.json ${packageName}.`
    );
  }
  parseSemver(metadata.version);
  if (metadata.declarations !== "local-provider.api.d.ts") {
    throw new Error(`Unexpected API baseline declaration path: ${String(metadata.declarations)}`);
  }
}

function parseSemver(version) {
  const match =
    typeof version === "string"
      ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
          version
        )
      : null;
  if (match === null) {
    throw new Error(`Invalid semantic version: ${String(version)}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) {
      return left[key] > right[key] ? 1 : -1;
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function comparePrereleaseIdentifier(left, right) {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? -1 : 1;
  }
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return compareText(left, right);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main(args) {
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) {
    throw new Error("Usage: node scripts/api-surface.mjs --check|--write");
  }
  if (args[0] === "--write") {
    await writeBaseline();
    return;
  }
  await checkApiSurface();
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  await main(process.argv.slice(2));
}
