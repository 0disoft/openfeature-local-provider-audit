import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_SCENARIOS = [
  "fast-unbounded",
  "lock-stalled-unbounded",
  "lock-stalled-bounded-reject",
  "lock-stalled-bounded-drop-newest"
];
const DEFAULT_EXPECTED_PLATFORMS = ["linux", "darwin", "win32"];

export async function summarizeBenchmarkDirectory(
  inputDirectory,
  expectedPlatforms = DEFAULT_EXPECTED_PLATFORMS
) {
  assertUniqueStrings(expectedPlatforms, "expected platforms");
  const reportPaths = await findReportFiles(resolve(inputDirectory));
  if (reportPaths.length !== expectedPlatforms.length) {
    throw new Error(
      `Expected ${expectedPlatforms.length} benchmark reports, found ${reportPaths.length}.`
    );
  }

  const reports = [];
  for (const reportPath of reportPaths) {
    const source = await readFile(reportPath, "utf8");
    let report;
    try {
      report = JSON.parse(source);
    } catch (error) {
      throw new Error(`Invalid JSON in ${reportPath}: ${error.message}`);
    }
    validateReport(report, reportPath);
    reports.push(report);
  }

  const reportsByPlatform = new Map();
  for (const report of reports) {
    const platform = report.environment.platform;
    if (reportsByPlatform.has(platform)) {
      throw new Error(`Duplicate benchmark platform: ${platform}.`);
    }
    reportsByPlatform.set(platform, report);
  }

  const missingPlatforms = expectedPlatforms.filter((platform) => !reportsByPlatform.has(platform));
  const unexpectedPlatforms = [...reportsByPlatform.keys()].filter(
    (platform) => !expectedPlatforms.includes(platform)
  );
  if (missingPlatforms.length > 0 || unexpectedPlatforms.length > 0) {
    throw new Error(
      `Benchmark platform set mismatch: missing=${formatList(missingPlatforms)}, unexpected=${formatList(unexpectedPlatforms)}.`
    );
  }

  const orderedReports = expectedPlatforms.map((platform) => reportsByPlatform.get(platform));
  const parameters = orderedReports[0].parameters;
  for (const report of orderedReports.slice(1)) {
    if (!sameParameters(parameters, report.parameters)) {
      throw new Error(
        `Benchmark parameters differ for ${report.environment.platform}: expected ${JSON.stringify(parameters)}, got ${JSON.stringify(report.parameters)}.`
      );
    }
  }

  return {
    schemaVersion: 1,
    parameters: structuredClone(parameters),
    platforms: orderedReports.map((report) => ({
      environment: structuredClone(report.environment),
      scenarios: EXPECTED_SCENARIOS.map((name) =>
        structuredClone(report.scenarios.find((scenario) => scenario.name === name))
      )
    }))
  };
}

export function renderBenchmarkMarkdown(summary) {
  const lines = [
    "# Audit queue benchmark",
    "",
    `Inputs: writes=${summary.parameters.writes}, queue=${summary.parameters.queueSize}, stall=${summary.parameters.stallMs}ms`,
    "",
    "Timing and heap values are sampled and informational. Validation gates report structure, identical inputs, queue accounting, overflow behavior, and zero failed writes.",
    "",
    "| Platform | Scenario | Enqueue ms | Drain ms | Total ms | Peak pending | Written | Rejected | Dropped | Failed | Heap delta MiB |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const platform of summary.platforms) {
    for (const scenario of platform.scenarios) {
      lines.push(
        `| ${platform.environment.platform} | ${scenario.name} | ${formatNumber(scenario.enqueueMs)} | ${formatNumber(scenario.drainMs)} | ${formatNumber(scenario.totalMs)} | ${scenario.peakPendingWrites} | ${scenario.writtenWrites} | ${scenario.rejectedWrites} | ${scenario.droppedWrites} | ${scenario.failedWrites} | ${formatNumber(scenario.heapDeltaBytes / 1024 / 1024)} |`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function runCli(args) {
  const options = parseOptions(args);
  const summary = await summarizeBenchmarkDirectory(options.input, options.expectedPlatforms);
  const markdown = renderBenchmarkMarkdown(summary);
  await writeTextFile(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  await writeTextFile(options.markdown, markdown);

  if (options.githubSummary) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) {
      throw new Error("GITHUB_STEP_SUMMARY is required with --github-summary.");
    }
    await appendFile(summaryPath, markdown, "utf8");
  }

  console.log(
    `Validated ${summary.platforms.length} benchmark reports with ${summary.platforms.length * EXPECTED_SCENARIOS.length} scenario results.`
  );
}

function validateReport(report, reportPath) {
  assertObject(report, `report ${reportPath}`);
  assertEqual(report.schemaVersion, 1, `${reportPath} schemaVersion`);
  assertObject(report.environment, `${reportPath} environment`);
  assertNonEmptyString(report.environment.platform, `${reportPath} environment.platform`);
  assertNonEmptyString(report.environment.architecture, `${reportPath} environment.architecture`);
  assertNonEmptyString(report.environment.node, `${reportPath} environment.node`);
  validateParameters(report.parameters, reportPath);

  if (!Array.isArray(report.scenarios) || report.scenarios.length !== EXPECTED_SCENARIOS.length) {
    throw new Error(`${reportPath} must contain ${EXPECTED_SCENARIOS.length} scenarios.`);
  }

  const scenariosByName = new Map();
  for (const scenario of report.scenarios) {
    validateScenario(scenario, report.parameters, reportPath);
    if (scenariosByName.has(scenario.name)) {
      throw new Error(`${reportPath} contains duplicate scenario ${scenario.name}.`);
    }
    scenariosByName.set(scenario.name, scenario);
  }

  for (const scenarioName of EXPECTED_SCENARIOS) {
    if (!scenariosByName.has(scenarioName)) {
      throw new Error(`${reportPath} is missing scenario ${scenarioName}.`);
    }
  }

  validateScenarioSemantics(scenariosByName, report.parameters, reportPath);
}

function validateParameters(parameters, reportPath) {
  assertObject(parameters, `${reportPath} parameters`);
  assertPositiveInteger(parameters.writes, `${reportPath} parameters.writes`);
  assertPositiveInteger(parameters.queueSize, `${reportPath} parameters.queueSize`);
  assertPositiveInteger(parameters.stallMs, `${reportPath} parameters.stallMs`);
}

function validateScenario(scenario, parameters, reportPath) {
  assertObject(scenario, `${reportPath} scenario`);
  assertNonEmptyString(scenario.name, `${reportPath} scenario.name`);
  if (!EXPECTED_SCENARIOS.includes(scenario.name)) {
    throw new Error(`${reportPath} contains unknown scenario ${scenario.name}.`);
  }

  assertEqual(
    scenario.writesRequested,
    parameters.writes,
    `${reportPath} ${scenario.name} writesRequested`
  );
  for (const field of [
    "peakPendingWrites",
    "writtenWrites",
    "rejectedWrites",
    "droppedWrites",
    "failedWrites"
  ]) {
    assertNonNegativeInteger(scenario[field], `${reportPath} ${scenario.name} ${field}`);
  }
  for (const field of ["enqueueMs", "drainMs", "totalMs"]) {
    assertNonNegativeFiniteNumber(scenario[field], `${reportPath} ${scenario.name} ${field}`);
  }
  if (typeof scenario.heapDeltaBytes !== "number" || !Number.isFinite(scenario.heapDeltaBytes)) {
    throw new Error(`${reportPath} ${scenario.name} heapDeltaBytes must be finite.`);
  }

  const accountedWrites =
    scenario.writtenWrites +
    scenario.rejectedWrites +
    scenario.droppedWrites +
    scenario.failedWrites;
  assertEqual(
    accountedWrites,
    parameters.writes,
    `${reportPath} ${scenario.name} accounted writes`
  );
  assertEqual(scenario.failedWrites, 0, `${reportPath} ${scenario.name} failedWrites`);
}

function validateScenarioSemantics(scenarios, parameters, reportPath) {
  for (const name of ["fast-unbounded", "lock-stalled-unbounded"]) {
    const scenario = scenarios.get(name);
    assertEqual(scenario.maxQueueSize, null, `${reportPath} ${name} maxQueueSize`);
    assertEqual(scenario.queueOverflowPolicy, null, `${reportPath} ${name} queueOverflowPolicy`);
    assertEqual(scenario.writtenWrites, parameters.writes, `${reportPath} ${name} writtenWrites`);
    assertEqual(scenario.rejectedWrites, 0, `${reportPath} ${name} rejectedWrites`);
    assertEqual(scenario.droppedWrites, 0, `${reportPath} ${name} droppedWrites`);
  }

  const rejected = scenarios.get("lock-stalled-bounded-reject");
  validateBoundedScenario(rejected, parameters, reportPath, "reject");
  assertEqual(rejected.droppedWrites, 0, `${reportPath} reject scenario droppedWrites`);
  assertEqual(
    rejected.writtenWrites + rejected.rejectedWrites,
    parameters.writes,
    `${reportPath} reject scenario accounted writes`
  );

  const dropped = scenarios.get("lock-stalled-bounded-drop-newest");
  validateBoundedScenario(dropped, parameters, reportPath, "dropNewest");
  assertEqual(dropped.rejectedWrites, 0, `${reportPath} drop scenario rejectedWrites`);
  assertEqual(
    dropped.writtenWrites + dropped.droppedWrites,
    parameters.writes,
    `${reportPath} drop scenario accounted writes`
  );
}

function validateBoundedScenario(scenario, parameters, reportPath, overflowPolicy) {
  assertEqual(
    scenario.maxQueueSize,
    parameters.queueSize,
    `${reportPath} ${scenario.name} maxQueueSize`
  );
  assertEqual(
    scenario.queueOverflowPolicy,
    overflowPolicy,
    `${reportPath} ${scenario.name} queueOverflowPolicy`
  );
  if (scenario.peakPendingWrites > parameters.queueSize) {
    throw new Error(
      `${reportPath} ${scenario.name} peakPendingWrites exceeds queueSize: ${scenario.peakPendingWrites} > ${parameters.queueSize}.`
    );
  }
}

async function findReportFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const reportPaths = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      reportPaths.push(...(await findReportFiles(entryPath)));
    } else if (entry.isFile() && entry.name === "result.json") {
      reportPaths.push(entryPath);
    }
  }
  return reportPaths.sort();
}

function parseOptions(args) {
  const options = {
    input: undefined,
    output: undefined,
    markdown: undefined,
    expectedPlatforms: DEFAULT_EXPECTED_PLATFORMS,
    githubSummary: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--github-summary") {
      options.githubSummary = true;
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.trim() === "") {
      throw new Error(`Missing value for ${argument}.`);
    }
    if (argument === "--input") {
      options.input = value;
    } else if (argument === "--output") {
      options.output = value;
    } else if (argument === "--markdown") {
      options.markdown = value;
    } else if (argument === "--expected-platforms") {
      options.expectedPlatforms = value.split(",").map((platform) => platform.trim());
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }

  for (const field of ["input", "output", "markdown"]) {
    if (options[field] === undefined) {
      throw new Error(`--${field} is required.`);
    }
  }
  assertUniqueStrings(options.expectedPlatforms, "expected platforms");
  return options;
}

async function writeTextFile(filePath, contents) {
  const resolvedPath = resolve(filePath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, contents, "utf8");
}

function sameParameters(left, right) {
  return (
    left.writes === right.writes &&
    left.queueSize === right.queueSize &&
    left.stallMs === right.stallMs
  );
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
  for (const value of values) {
    assertNonEmptyString(value, label);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function assertNonNegativeFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function assertEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function formatList(values) {
  return values.length === 0 ? "none" : values.join(",");
}

function formatNumber(value) {
  return Math.round(value * 100) / 100;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await runCli(process.argv.slice(2));
}
