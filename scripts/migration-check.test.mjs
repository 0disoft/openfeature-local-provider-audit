import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MIGRATION_SOURCE_BASELINE,
  REQUIRED_MIGRATION_LITERALS,
  checkMigrationGuide,
  validateMigrationGuide
} from "./migration-check.mjs";

test("accepts a complete inventory linked to the current package version", () => {
  assert.deepEqual(
    validateMigrationGuide({
      packageVersion: "0.16.0",
      guide: createCompleteGuide("0.16.0")
    }),
    []
  );
});

test("keeps the 0.x migration baseline while validating RC source metadata", () => {
  assert.deepEqual(
    validateMigrationGuide({
      packageVersion: "1.0.0-rc.1",
      guide: createCompleteGuide("1.0.0-rc.1")
    }),
    []
  );
});

test("rejects a missing source-version migration path", () => {
  const guide = createCompleteGuide("0.16.0").replace("## Upgrade from 0.15.x", "");
  assert.match(
    validateMigrationGuide({ packageVersion: "0.16.0", guide }).join("\n"),
    /Upgrade from 0\.15\.x/
  );
});

test("rejects stale package-version linkage", () => {
  const errors = validateMigrationGuide({
    packageVersion: "1.0.0-rc.1",
    guide: createCompleteGuide("0.16.0")
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /1\.0\.0-rc\.1/);
});

test("reads package metadata and the migration guide from one repository root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "migration-check-"));
  try {
    await mkdir(path.join(root, "packages", "local-provider"), { recursive: true });
    await mkdir(path.join(root, "docs", "library"), { recursive: true });
    await writeFile(
      path.join(root, "packages", "local-provider", "package.json"),
      JSON.stringify({ version: "0.16.0" }),
      "utf8"
    );
    await writeFile(
      path.join(root, "docs", "library", "migration-to-1.0.md"),
      createCompleteGuide("0.16.0"),
      "utf8"
    );

    assert.deepEqual(await checkMigrationGuide(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createCompleteGuide(version) {
  return [
    `Current repository package version: \`${version}\`.`,
    `- Current source baseline: repository package version \`${MIGRATION_SOURCE_BASELINE}\`.`,
    ...REQUIRED_MIGRATION_LITERALS
  ].join("\n");
}
