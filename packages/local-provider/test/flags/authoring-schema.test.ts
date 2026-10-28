import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { expect, it } from "vitest";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../schemas/${name}.json`, import.meta.url), "utf8"));
const ajv = new Ajv({ strict: true, allErrors: true });
const runtime1 = ajv.compile(load("v1"));
const runtime2 = ajv.compile(load("v2"));
const schema = load("authoring-v1");
const check = ajv.compile(schema);
const leaf = { attribute: ["tenant"], op: "eq", value: "pilot" };
const source = (when: unknown = { segment: "pilot" }, segments: object = { pilot: leaf }) => ({
  authoringVersion: 1,
  segments,
  snapshot: {
    schemaVersion: 2,
    flags: {
      feature: {
        type: "boolean",
        variants: { on: true, off: false },
        defaultVariant: "off",
        rules: [{ id: "pilot", when, variant: "on" }]
      }
    }
  }
});

it.each([
  leaf,
  { segment: "pilot" },
  { not: { segment: "pilot" } },
  { all: [{ segment: "pilot" }, { attribute: ["plan"], op: "exists", value: true }] },
  { any: [{ segment: "pilot" }, leaf] }
])("accepts reusable structure without confusing runtime schemas %#", (when) => {
  const input = source(when);
  expect(check(input), JSON.stringify(check.errors)).toBe(true);
  expect(runtime1(input)).toBe(false);
  expect(runtime2(input)).toBe(false);
});

it.each([
  { ...source(), authoringVersion: 2 },
  { ...source(), unexpected: true },
  { ...source(), $schema: "must-associate-externally" },
  { ...source(), segments: [] },
  source({ segment: "" }),
  source({ segment: " " }),
  source({ segment: "n".repeat(129) }),
  source({ segment: "pilot", not: leaf }),
  source({ segment: "pilot", value: 1 }),
  source({ all: [] }),
  source({ not: [] }),
  source({ attribute: ["constructor"], op: "exists", value: false }),
  source(leaf, { "": leaf }),
  source(leaf, { ["n".repeat(129)]: leaf }),
  source(leaf, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`s${i}`, leaf]))),
  { ...source(), snapshot: { schemaVersion: 1, flags: {} } }
])("rejects malformed authoring structure %#", (input) => {
  expect(check(input)).toBe(false);
});

it("keeps reference/cycle/budget checks explicitly outside structural acceptance", () => {
  expect(check(source({ segment: "missing" }))).toBe(true);
  expect(check(source({ segment: "cycle" }, { cycle: { segment: "cycle" } }))).toBe(true);
  const definitions = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`s${i}`, leaf]));
  expect(check(source({ segment: "s0" }, definitions))).toBe(true);
  expect(check(source({ segment: "__proto__" }, Object.fromEntries([["__proto__", leaf]])))).toBe(
    true
  );
});

it("keeps all schema references local and runtime conditions free of segment syntax", () => {
  function references(value: unknown): string[] {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, child]) =>
      key === "$ref" ? [String(child)] : references(child)
    );
  }
  expect(references(schema).every((ref) => ref.startsWith("#/definitions/"))).toBe(true);
  expect(runtime2(source().snapshot)).toBe(false);
  expect(runtime2(source(leaf).snapshot)).toBe(true);
});
