import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const run = promisify(execFile);
const root = process.cwd();
const output = resolve("output/playwright");
const directory = await mkdtemp(join(tmpdir(), "of-review-html-"));
const cli = resolve("packages/local-provider/bin/openfeature-local-provider.js");
let browser;
try {
  await mkdir(output, { recursive: true });
  const { stdout } = await run(
    process.execPath,
    [
      cli,
      "compare",
      "examples/flag-review/before.json",
      "examples/flag-review/after.json",
      "--requests",
      "examples/flag-review/requests.json",
      "--output",
      "html",
      "--max-changed-values-percent",
      "50"
    ],
    { cwd: root, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
  );
  const reportPath = join(directory, "review.html");
  await writeFile(reportPath, stdout);
  await copyFile(reportPath, join(output, "flag-review.html"));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.REVIEW_BROWSER_BINARY
      ? { executablePath: process.env.REVIEW_BROWSER_BINARY }
      : process.platform === "win32"
        ? { channel: "msedge" }
        : {})
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    offline: true,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const network = [];
  const errors = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    errors.push("Unexpected dialog");
    await dialog.dismiss();
  });
  await page.goto(pathToFileURL(reportPath).href);
  assert.equal(
    await page.getByRole("heading", { name: "Flag change review", exact: true }).count(),
    1
  );
  assert.equal(await page.locator("meter").getAttribute("value"), "2");
  assert.equal(await page.locator("meter").getAttribute("max"), "4");
  assert.equal(await page.locator("script,img,iframe,link,form").count(), 0);
  assert.equal(await page.getByText("Review ready", { exact: true }).count(), 1);
  assert.equal(await page.locator("table").count(), 3);
  const summary = page.locator("summary").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("details").first().getAttribute("open"), null);
  await page.keyboard.press("Enter");
  assert.notEqual(await page.locator("details").first().getAttribute("open"), null);
  await page.screenshot({ path: join(output, "flag-review-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(output, "flag-review-mobile.png"), fullPage: true });
  const hostile =
    '</code><img src="https://attacker.invalid/x" onerror="alert(1)"><script>alert(2)</script>';
  const snapshot = {
    schemaVersion: 1,
    flags: { [hostile]: { type: "boolean", defaultVariant: "off", variants: { off: false } } }
  };
  await writeFile(join(directory, "flags.json"), JSON.stringify(snapshot));
  await writeFile(
    join(directory, "requests.json"),
    JSON.stringify([
      {
        flagKey: hostile,
        expectedType: "boolean",
        defaultValue: false,
        context: { secret: "must-not-appear" }
      }
    ])
  );
  const attack = await run(
    process.execPath,
    [cli, "compare", "flags.json", "flags.json", "--requests", "requests.json", "--output", "html"],
    { cwd: directory, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
  );
  assert(!attack.stdout.includes("must-not-appear"));
  const attackPath = join(directory, "hostile.html");
  await writeFile(attackPath, attack.stdout);
  await page.goto(pathToFileURL(attackPath).href);
  assert.equal(await page.locator("script,img,iframe,link,form").count(), 0);
  assert((await page.locator("main").textContent())?.includes(hostile));
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "static-review-browser-passed",
      browser: browser.version(),
      desktop: "1440x1000",
      mobile: "390x844",
      externalRequests: network.length,
      injection: "text only",
      output
    })
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
