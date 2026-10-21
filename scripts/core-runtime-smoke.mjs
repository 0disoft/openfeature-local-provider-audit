import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import workerdModule, { compatibilityDate } from "workerd";
import * as native from "../packages/local-provider/dist/index.js";
import { runCoreContract } from "./core-runtime-corpus.mjs";

const runFile = promisify(execFile);
const workerd = workerdModule.default;
assert.equal(typeof workerd, "string", "workerd native binary path is missing.");
const root = process.cwd();
const selected = process.argv[2]?.split(",") ?? ["bun", "deno", "browser", "workerd"];
assert(
  selected.length > 0 &&
    selected.every((name) => ["bun", "deno", "browser", "workerd"].includes(name)),
  "Unknown runtime selection."
);
assert(process.env.npm_execpath, "Run through the configured pnpm script.");
const directory = await mkdtemp(join(tmpdir(), "of-core-runtimes-"));
const run = (command, args, cwd = directory) =>
  runFile(command, args, { cwd, timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = JSON.parse(JSON.stringify(runCoreContract(native)));
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  packageVersion: "",
  tarballHash: "",
  coreHash: "",
  cases: expected.results.length,
  parseFailures: expected.parseErrors.length,
  resultHash: digest(JSON.stringify(expected)),
  host: { node: process.version, platform: process.platform, arch: process.arch },
  runtimes: []
};

try {
  const pnpm = process.env.npm_execpath;
  const pnpmIsScript = /\.[cm]?js$/i.test(pnpm);
  await run(
    pnpmIsScript ? process.execPath : pnpm,
    [
      ...(pnpmIsScript ? [pnpm] : []),
      "--filter",
      "@0disoft/openfeature-local-provider",
      "pack",
      "--pack-destination",
      directory
    ],
    root
  );
  const tarball = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
  assert(tarball, "Packed artifact missing.");
  report.tarballHash = digest(await readFile(join(directory, tarball)));
  await run("tar", ["-xzf", join(directory, tarball), "-C", directory]);
  report.packageVersion = JSON.parse(
    await readFile(join(directory, "package/package.json"), "utf8")
  ).version;
  const core = await readFile(join(directory, "package/dist/core.js"));
  report.coreHash = digest(core);
  await writeFile(join(directory, "core.mjs"), core);
  await copyFile(join(root, "scripts/core-runtime-corpus.mjs"), join(directory, "corpus.mjs"));
  await writeFile(
    join(directory, "run.mjs"),
    'import * as core from "./core.mjs"; import {runCoreContract} from "./corpus.mjs"; console.log(JSON.stringify(runCoreContract(core)));'
  );
  for (const name of selected) {
    let actual;
    let version;
    if (name === "bun" || name === "deno") {
      const binary =
        name === "bun"
          ? (process.env.CORE_BUN_BINARY ?? "bun")
          : (process.env.CORE_DENO_BINARY ?? "deno");
      version = (await run(binary, ["--version"])).stdout.trim();
      const args =
        name === "bun"
          ? ["run", "run.mjs"]
          : [
              "run",
              "--no-config",
              "--no-lock",
              "--no-npm",
              "--cached-only",
              "--no-prompt",
              "--deny-read",
              "--deny-write",
              "--deny-net",
              "--deny-env",
              "--deny-run",
              "run.mjs"
            ];
      actual = JSON.parse((await run(binary, args)).stdout);
    } else if (name === "browser") {
      const result = await browserResult();
      actual = result.actual;
      version = result.version;
    } else {
      version = (await run(workerd, ["--version"])).stdout.trim();
      actual = await workerResult();
    }
    assert.deepEqual(actual, expected, `${name} differs from the native Node reference.`);
    report.runtimes.push({
      name,
      version,
      passed: true,
      resultHash: digest(JSON.stringify(actual)),
      ...(name === "workerd"
        ? { compatibilityDate, compatibilityFlags: ["no_nodejs_compat", "no_nodejs_compat_v2"] }
        : {})
    });
    console.log(`${name}: passed ${report.cases} cases and ${report.parseFailures} parse failures`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (process.env.CORE_RUNTIME_REPORT)
    await writeFile(
      resolve(root, process.env.CORE_RUNTIME_REPORT),
      `${JSON.stringify(report, null, 2)}\n`
    );
} finally {
  assert(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}of-core-runtimes-`));
  await rm(directory, { recursive: true, force: true });
}

async function browserResult() {
  const modules = new Map([
    ["/core.mjs", await readFile(join(directory, "core.mjs"))],
    ["/corpus.mjs", await readFile(join(directory, "corpus.mjs"))]
  ]);
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><title>Portable core fixture</title>");
      return;
    }
    const content = modules.get(request.url);
    response.writeHead(content ? 200 : 404, { "content-type": "text/javascript" }).end(content);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  let evaluationTimer;
  try {
    if (process.env.CORE_BROWSER_BINARY) await access(process.env.CORE_BROWSER_BINARY);
    browser = await chromium.launch({
      headless: true,
      timeout: 15000,
      ...(process.env.CORE_BROWSER_BINARY
        ? { executablePath: process.env.CORE_BROWSER_BINARY }
        : {})
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`, { timeout: 15000 });
    const evaluation = page.evaluate(async () => {
      if (
        typeof globalThis.process !== "undefined" ||
        typeof globalThis.Buffer !== "undefined" ||
        typeof globalThis.require !== "undefined"
      )
        throw new Error("Node globals unexpectedly present.");
      const core = await import("/core.mjs");
      const { runCoreContract } = await import("/corpus.mjs");
      return runCoreContract(core);
    });
    const actual = await Promise.race([
      evaluation,
      new Promise((_, reject) => {
        evaluationTimer = setTimeout(
          () => reject(new Error("Browser core evaluation timed out.")),
          15000
        );
      })
    ]);
    return { actual, version: browser.version() };
  } finally {
    clearTimeout(evaluationTimer);
    try {
      await browser?.close();
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  }
}

async function workerResult() {
  const fixtureId = basename(directory);
  await writeFile(
    join(directory, "worker.mjs"),
    `import * as core from "./core.mjs"; import {runCoreContract} from "./corpus.mjs"; export default {fetch(){if(typeof globalThis.process!=="undefined"||typeof globalThis.Buffer!=="undefined"||typeof globalThis.require!=="undefined")throw new Error("Node globals present");return Response.json(runCoreContract(core),{headers:{"x-core-fixture":${JSON.stringify(fixtureId)}}});}};`
  );
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  await writeFile(
    join(directory, "config.capnp"),
    `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (services = [(name = "main", worker = (compatibilityDate = "${compatibilityDate}", compatibilityFlags = ["no_nodejs_compat", "no_nodejs_compat_v2"], modules = [(name = "worker.mjs", esModule = embed "worker.mjs"), (name = "core.mjs", esModule = embed "core.mjs"), (name = "corpus.mjs", esModule = embed "corpus.mjs")]))], sockets = [(name = "http", address = "127.0.0.1:${port}", http = (), service = "main")]);`
  );
  const child = spawn(workerd, ["serve", "config.capnp"], {
    cwd: directory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostics = "";
  let failure;
  child.on("error", (error) => {
    failure = error;
  });
  child.stdout.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-8192);
  });
  child.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-8192);
  });
  const stopped = new Promise((done) => child.once("close", done));
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (failure || child.exitCode !== null)
        throw new Error(`workerd exited: ${failure ?? diagnostics}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(1000)
        });
        assert.equal(response.status, 200, diagnostics);
        assert.equal(
          response.headers.get("x-core-fixture"),
          fixtureId,
          "Unexpected fixture listener."
        );
        return await response.json();
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        await delay(100);
      }
    }
    throw new Error(`workerd did not become ready: ${diagnostics}`);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await stopped;
  }
}
