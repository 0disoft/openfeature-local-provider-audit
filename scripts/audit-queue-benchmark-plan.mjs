import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNNERS = [
  { os: "ubuntu-latest", platform: "linux" },
  { os: "windows-latest", platform: "win32" },
  { os: "macos-15", platform: "darwin" }
];

const FIXED_PROFILES = {
  quick: [
    {
      sample: "quick",
      writes: 5_000,
      queueSize: 1_000,
      stallMs: 100,
      repetitions: 1
    }
  ],
  decision: [
    {
      sample: "short",
      writes: 5_000,
      queueSize: 1_000,
      stallMs: 1_000,
      repetitions: 3
    },
    {
      sample: "medium",
      writes: 10_000,
      queueSize: 1_000,
      stallMs: 5_000,
      repetitions: 3
    },
    {
      sample: "sustained",
      writes: 25_000,
      queueSize: 1_000,
      stallMs: 30_000,
      repetitions: 3
    }
  ]
};

export function createBenchmarkPlan(profile, customParameters) {
  const samples = resolveSamples(profile, customParameters);
  const include = [];

  for (const sample of samples) {
    for (let repetition = 1; repetition <= sample.repetitions; repetition += 1) {
      for (const runner of RUNNERS) {
        include.push({
          os: runner.os,
          platform: runner.platform,
          sample: sample.sample,
          repetition,
          writes: sample.writes,
          queueSize: sample.queueSize,
          stallMs: sample.stallMs
        });
      }
    }
  }

  return {
    profile,
    samples: structuredClone(samples),
    matrix: { include }
  };
}

async function runCli(args) {
  const options = parseOptions(args);
  const plan = createBenchmarkPlan(options.profile, {
    writes: options.writes,
    queueSize: options.queueSize,
    stallMs: options.stallMs
  });

  if (options.githubOutput) {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) {
      throw new Error("GITHUB_OUTPUT is required with --github-output.");
    }
    await appendFile(outputPath, `matrix=${JSON.stringify(plan.matrix)}\n`, "utf8");
    await appendFile(outputPath, `profile=${plan.profile}\n`, "utf8");
  } else {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
}

function resolveSamples(profile, customParameters) {
  if (profile === "quick" || profile === "decision") {
    return FIXED_PROFILES[profile];
  }
  if (profile === "custom") {
    assertPositiveInteger(customParameters?.writes, "custom writes");
    assertPositiveInteger(customParameters?.queueSize, "custom queue size");
    assertPositiveInteger(customParameters?.stallMs, "custom stall milliseconds");
    return [
      {
        sample: "custom",
        writes: customParameters.writes,
        queueSize: customParameters.queueSize,
        stallMs: customParameters.stallMs,
        repetitions: 1
      }
    ];
  }
  throw new Error(`Unknown benchmark profile: ${profile}.`);
}

function parseOptions(args) {
  const options = {
    profile: undefined,
    writes: undefined,
    queueSize: undefined,
    stallMs: undefined,
    githubOutput: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--github-output") {
      options.githubOutput = true;
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.trim() === "") {
      throw new Error(`Missing value for ${argument}.`);
    }
    if (argument === "--profile") {
      options.profile = value;
    } else if (argument === "--writes") {
      options.writes = parsePositiveInteger(value, argument);
    } else if (argument === "--queue-size") {
      options.queueSize = parsePositiveInteger(value, argument);
    } else if (argument === "--stall-ms") {
      options.stallMs = parsePositiveInteger(value, argument);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }

  if (options.profile === undefined) {
    throw new Error("--profile is required.");
  }
  return options;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  assertPositiveInteger(parsed, label);
  return parsed;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await runCli(process.argv.slice(2));
}
