import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { loadFlagSnapshotFile } from "../../src/flags/snapshot-file.js";
import type { LoadFlagSnapshotFileOptions } from "../../src/public-types.js";

function snapshot(value: boolean): string {
  return JSON.stringify({
    schemaVersion: 1,
    flags: {
      critical: { type: "boolean", variants: { live: value }, defaultVariant: "live" }
    }
  });
}

it("captures a file URL before stat/open can observe different caller paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-url-capture-"));
  try {
    const original = join(directory, "original #%.json");
    const replacement = join(directory, "replacement.json");
    await writeFile(original, snapshot(true));
    await writeFile(replacement, snapshot(false));
    const url = pathToFileURL(original);
    const loading = loadFlagSnapshotFile(url);
    url.href = pathToFileURL(replacement).href;
    const loaded = await loading;
    expect(loaded.flags.critical?.variants.live).toBe(true);
    expect(url.href).toBe(pathToFileURL(replacement).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("captures format with the read settings instead of consulting mutated options at EOF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-format-capture-"));
  try {
    const path = join(directory, "flags.data");
    await writeFile(path, "schemaVersion: 1\nflags: {}\n");
    const options: LoadFlagSnapshotFileOptions = { format: "yaml" };
    const loading = loadFlagSnapshotFile(path, options);
    Object.assign(options, { format: "json", maxBytes: 1, encoding: "hex" });
    expect(await loading).toMatchObject({ schemaVersion: 1, flags: {} });
    expect(options.format).toBe("json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
