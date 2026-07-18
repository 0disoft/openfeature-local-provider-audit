import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeDeclarationFile,
  classifySurfaceChanges,
  compareDeclarationSurfaces,
  isVersionSufficient
} from "./api-surface.mjs";

test("declaration analysis records value/type spaces and supporting declarations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "api-surface-test-"));
  try {
    const declarationPath = path.join(directory, "index.d.ts");
    await writeFile(
      declarationPath,
      `interface InternalOptions {
  readonly mode: "safe";
}
export interface PublicOptions {
  readonly internal: InternalOptions;
}
export declare class PublicError extends Error {}
export declare function createValue(options: PublicOptions): string;
`,
      "utf8"
    );

    const surface = await analyzeDeclarationFile(declarationPath);
    const byName = new Map(surface.map((entry) => [entry.name, entry]));

    assert.deepEqual(byName.get("PublicOptions")?.spaces, ["type"]);
    assert.deepEqual(byName.get("PublicError")?.spaces, ["type", "value"]);
    assert.deepEqual(byName.get("createValue")?.spaces, ["value"]);
    assert.match(byName.get("PublicOptions")?.declarations.join("\n") ?? "", /InternalOptions/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("supporting type changes are classified as breaking public declaration changes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "api-surface-test-"));
  try {
    const beforePath = path.join(directory, "before.d.ts");
    const afterPath = path.join(directory, "after.d.ts");
    await writeFile(
      beforePath,
      `interface InternalOptions { readonly limit: number; }
export interface PublicOptions { readonly internal: InternalOptions; }
`,
      "utf8"
    );
    await writeFile(
      afterPath,
      `interface InternalOptions { readonly limit: string; }
export interface PublicOptions { readonly internal: InternalOptions; }
`,
      "utf8"
    );

    const changes = compareDeclarationSurfaces(
      await analyzeDeclarationFile(beforePath),
      await analyzeDeclarationFile(afterPath)
    );

    assert.deepEqual(changes, [
      { kind: "changed", name: "InternalOptions", detail: "normalized declaration changed" },
      { kind: "changed", name: "PublicOptions", detail: "normalized declaration changed" }
    ]);
    assert.equal(classifySurfaceChanges(changes), "breaking");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("added exports are additive and version policy is conservative", () => {
  const before = [{ name: "Existing", spaces: ["type"], declarations: ["interface Existing {"] }];
  const after = [
    ...before,
    { name: "Added", spaces: ["value"], declarations: ["declare function Added(): void;"] }
  ];
  const changes = compareDeclarationSurfaces(before, after);

  assert.equal(classifySurfaceChanges(changes), "additive");
  assert.equal(isVersionSufficient("1.2.3", "1.3.0", "additive"), true);
  assert.equal(isVersionSufficient("1.2.3", "1.2.4", "additive"), false);
  assert.equal(isVersionSufficient("1.2.3", "2.0.0", "breaking"), true);
  assert.equal(isVersionSufficient("1.2.3", "1.3.0", "breaking"), false);
  assert.equal(isVersionSufficient("0.16.0", "0.17.0", "breaking"), true);
  assert.equal(isVersionSufficient("0.16.0", "0.16.1", "breaking"), false);
  assert.equal(isVersionSufficient("1.0.0-rc.1", "1.0.0-rc.2", "breaking"), true);
  assert.equal(isVersionSufficient("1.0.0-rc.1", "1.0.0", "breaking"), false);
});
