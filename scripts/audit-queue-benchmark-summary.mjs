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
const STATISTIC_FIELDS = [
  "enqueueMs",
  "drainMs",
  "totalMs",
  "peakPendingWrites",
  "writtenWrites",
  "rejectedWrites",
  "droppedWrites",
  "failedWrites",
  "heapDeltaBytes"
];

export async function summarizeBenchmarkDirectory(
  inputDirectory,
  expectedPlatforms = DEFAULT_EXPECTED_PLATFORMS
) {
  assertUniqueStrings(expectedPlatforms, "expected platforms");
  const reportPaths = await findReportFiles(resolve(inputDirectory));
  if (reportPaths.length === 0) {
    throw new Error("No benchmark reports were found.");
  }

  const reports = [];
  for (const reportPath of reportPaths) {
    reports.push(await readAndValidateReport(reportPath));
  }

  const profiles = new Set(reports.map((report) => report.sample.profile));
  if (profiles.size !== 1) {
    throw new Error(`Benchmark reports contain mixed profiles: ${[...profiles].sort().join(",")}.`);
  }

  const sampleGroups = groupReportsBySample(reports);
  const samples = [...sampleGroups.values()]
    .sort(compareSampleGroups)
    .map((group) => buildSampleSummary(group, expectedPlatforms));

  return {
    schemaVersion: 2,
    profile: reports[0].sample.profile,
    reportCount: reports.length,
    scenarioResultCount: reports.length * EXPECTED_SCENARIOS.length,
    samples
  };
}

export function renderBenchmarkMarkdown(summary) {
  const lines = [
    "# Audit queue benchmark",
    "",
    `Profile: ${summary.profile}; reports=${summary.reportCount}; scenario results=${summary.scenarioResultCount}`,
    "",
    "Timing and heap values are sampled and informational. Validation gates report structure, complete platform repetitions, queue accounting, overflow behavior, and zero failed writes."
  ];

  for (const sample of summary.samples) {
    lines.push(
      "",
      `## ${sample.id}`,
      "",
      `Inputs: writes=${sample.parameters.writes}, queue=${sample.parameters.queueSize}, stall=${sample.parameters.stallMs}ms; repetitions=${sample.repetitions.length}`,
      "",
      "| Platform | Scenario | Runs | Enqueue p50/max ms | Drain p50/max ms | Total p50/max ms | Peak max | Written p50 | Rejected p50 | Dropped p50 | Heap p50/max MiB |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );

    for (const statistic of sample.statistics) {
      const metrics = statistic.metrics;
      lines.push(
        `| ${statistic.platform} | ${statistic.scenario} | ${statistic.runs} | ${formatPair(metrics.enqueueMs)} | ${formatPair(metrics.drainMs)} | ${formatPair(metrics.totalMs)} | ${formatNumber(metrics.peakPendingWrites.max)} | ${formatNumber(metrics.writtenWrites.median)} | ${formatNumber(metrics.rejectedWrites.median)} | ${formatNumber(metrics.droppedWrites.median)} | ${formatPair(scaleStatistic(metrics.heapDeltaBytes, 1024 * 1024))} |`
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
    `Validated ${summary.reportCount} benchmark reports with ${summary.scenarioResultCount} scenario results across ${summary.samples.length} samples.`
  );
}

async function readAndValidateReport(reportPath) {
  const source = await readFile(reportPath, "utf8");
  let report;
  try {
    report = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${reportPath}: ${error.message}`);
  }
  validateReport(report, reportPath);
  return normalizeReport(report);
}

function normalizeReport(report) {
  if (report.schemaVersion === 2) {
    return structuredClone(report);
  }
  return {
    ...structuredClone(report),
    sample: {
      profile: "legacy",
      id: `legacy-${report.parameters.writes}-${report.parameters.queueSize}-${report.parameters.stallMs}`,
      repetition: 1
    }
  };
}

function groupReportsBySample(reports) {
  const groups = new Map();
  for (const report of reports) {
    let group = groups.get(report.sample.id);
    if (!group) {
      group = {
        id: report.sample.id,
        parameters: structuredClone(report.parameters),
        repetitions: new Map()
      };
      groups.set(report.sample.id, group);
    } else if (!sameParameters(group.parameters, report.parameters)) {
      throw new Error(
        `Benchmark parameters differ within sample ${report.sample.id}: expected ${JSON.stringify(group.parameters)}, got ${JSON.stringify(report.parameters)}.`
      );
    }

    let repetition = group.repetitions.get(report.sample.repetition);
    if (!repetition) {
      repetition = new Map();
      group.repetitions.set(report.sample.repetition, repetition);
    }
    const platform = report.environment.platform;
    if (repetition.has(platform)) {
      throw new Error(
        `Duplicate benchmark report for ${report.sample.id} repetition ${report.sample.repetition} platform ${platform}.`
      );
    }
    repetition.set(platform, report);
  }
  return groups;
}

function buildSampleSummary(group, expectedPlatforms) {
  const repetitionNumbers = [...group.repetitions.keys()].sort((left, right) => left - right);
  for (let index = 0; index < repetitionNumbers.length; index += 1) {
    if (repetitionNumbers[index] !== index + 1) {
      throw new Error(
        `Sample ${group.id} repetitions must be contiguous from 1, got ${repetitionNumbers.join(",")}.`
      );
    }
  }

  const repetitions = repetitionNumbers.map((repetitionNumber) => {
    const reportsByPlatform = group.repetitions.get(repetitionNumber);
    assertPlatformSet(reportsByPlatform, expectedPlatforms, group.id, repetitionNumber);
    return {
      repetition: repetitionNumber,
      platforms: expectedPlatforms.map((platform) => {
        const report = reportsByPlatform.get(platform);
        return {
          environment: structuredClone(report.environment),
          scenarios: orderScenarios(report.scenarios)
        };
      })
    };
  });

  return {
    id: group.id,
    parameters: structuredClone(group.parameters),
    repetitions,
    statistics: buildStatistics(repetitions, expectedPlatforms)
  };
}

function buildStatistics(repetitions, expectedPlatforms) {
  const statistics = [];
  for (const platform of expectedPlatforms) {
    for (const scenarioName of EXPECTED_SCENARIOS) {
      const scenarios = repetitions.map((repetition) => {
        const platformReport = repetition.platforms.find(
          (candidate) => candidate.environment.platform === platform
        );
        return platformReport.scenarios.find((scenario) => scenario.name === scenarioName);
      });
      const metrics = {};
      for (const field of STATISTIC_FIELDS) {
        metrics[field] = summarizeNumbers(scenarios.map((scenario) => scenario[field]));
      }
      statistics.push({
        platform,
        scenario: scenarioName,
        runs: scenarios.length,
        metrics
      });
    }
  }
  return statistics;
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    min: roundNumber(sorted[0]),
    median: roundNumber(median),
    max: roundNumber(sorted.at(-1))
  };
}

function scaleStatistic(statistic, divisor) {
  return {
    min: statistic.min / divisor,
    median: statistic.median / divisor,
    max: statistic.max / divisor
  };
}

function validateReport(report, reportPath) {
  assertObject(report, `report ${reportPath}`);
  if (report.schemaVersion !== 1 && report.schemaVersion !== 2) {
    throw new Error(`${reportPath} schemaVersion must be 1 or 2, got ${report.schemaVersion}.`);
  }
  if (report.schemaVersion === 2) {
    assertObject(report.sample, `${reportPath} sample`);
    assertIdentifier(report.sample.profile, `${reportPath} sample.profile`);
    assertIdentifier(report.sample.id, `${reportPath} sample.id`);
    assertPositiveInteger(report.sample.repetition, `${reportPath} sample.repetition`);
  }
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

function assertPlatformSet(reportsByPlatform, expectedPlatforms, sample, repetition) {
  const actualPlatforms = [...reportsByPlatform.keys()];
  const missing = expectedPlatforms.filter((platform) => !reportsByPlatform.has(platform));
  const unexpected = actualPlatforms.filter((platform) => !expectedPlatforms.includes(platform));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Benchmark platform set mismatch for ${sample} repetition ${repetition}: missing=${formatList(missing)}, unexpected=${formatList(unexpected)}.`
    );
  }
}

function orderScenarios(scenarios) {
  return EXPECTED_SCENARIOS.map((name) =>
    structuredClone(scenarios.find((scenario) => scenario.name === name))
  );
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

function compareSampleGroups(left, right) {
  return (
    left.parameters.stallMs - right.parameters.stallMs ||
    left.parameters.writes - right.parameters.writes ||
    left.id.localeCompare(right.id)
  );
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a lowercase identifier up to 64 characters.`);
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

function formatPair(statistic) {
  return `${formatNumber(statistic.median)}/${formatNumber(statistic.max)}`;
}

function formatNumber(value) {
  return roundNumber(value).toString();
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await runCli(process.argv.slice(2));
}
