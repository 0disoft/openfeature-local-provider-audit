import { readFile, mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const schemaDirectory = new URL("../packages/local-provider/schemas/", import.meta.url);
const mode = process.argv[2];
if (!["--write", "--check"].includes(mode) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/snapshot-schema.mjs --write|--check");
}
const ref = (name) => ({ $ref: `#/definitions/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});
const present = (...keys) => ({
  type: "object",
  properties: Object.fromEntries(keys.map((key) => [key, {}])),
  required: keys
});
const nonblank = { type: "string", pattern: "\\S" };
const scalar = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }]
};
const rollout = (version) => ({
  type: "array",
  minItems: 1,
  ...(version === 2 ? { maxItems: 100 } : {}),
  items: object(
    {
      variant: nonblank,
      percentage: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 100,
        description: "Runtime also checks three decimal places and total percentage <= 100."
      },
      seed: nonblank
    },
    ["variant", "percentage"]
  )
});

function schema(version) {
  const definitions = {
    json: {
      anyOf: [
        ...scalar.anyOf,
        { type: "array", items: ref("json") },
        { type: "object", additionalProperties: ref("json") }
      ]
    },
    metadata: { type: "object", additionalProperties: { anyOf: scalar.anyOf.slice(0, 3) } },
    rollout: rollout(version)
  };
  const properties = {
    type: { enum: ["boolean", "string", "number", "object"] },
    variants: { type: "object", minProperties: 1, propertyNames: nonblank },
    defaultVariant: nonblank,
    rollout: ref("rollout"),
    envVar: nonblank,
    metadata: ref("metadata")
  };
  if (version === 2) {
    const shortString = { ...nonblank, maxLength: 128 };
    const attribute = {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { ...shortString, not: { enum: ["__proto__", "prototype", "constructor"] } }
    };
    const scalarOperand = {
      anyOf: [{ type: "string", maxLength: 4096 }, ...scalar.anyOf.slice(1)]
    };
    definitions.condition = {
      description: "Runtime also limits condition depth to 8 and nodes per rule to 100.",
      oneOf: [
        object({ not: ref("condition") }),
        ...["all", "any"].map((name) =>
          object({ [name]: { type: "array", minItems: 1, maxItems: 20, items: ref("condition") } })
        ),
        object({ attribute, op: { const: "eq" }, value: scalarOperand }),
        object({ attribute, op: { const: "exists" }, value: { type: "boolean" } }),
        object({
          attribute,
          op: { enum: ["startsWith", "endsWith"] },
          value: { type: "string", minLength: 1, maxLength: 4096 }
        }),
        object({
          attribute,
          op: { const: "in" },
          value: { type: "array", minItems: 1, maxItems: 100, items: scalarOperand }
        }),
        object({ attribute, op: { enum: ["gt", "gte", "lt", "lte"] }, value: { type: "number" } }),
        object({
          attribute,
          op: { enum: ["semverEq", "semverGt", "semverGte", "semverLt", "semverLte"] },
          value: { type: "string", maxLength: 256, description: "Runtime requires strict SemVer." }
        })
      ]
    };
    definitions.rule = {
      ...object(
        {
          id: shortString,
          when: ref("condition"),
          // Variant references share the existing name contract, not the rule-ID limit.
          variant: nonblank,
          rollout: ref("rollout")
        },
        ["id", "when"]
      ),
      oneOf: [
        { ...present("variant"), not: present("rollout") },
        { ...present("rollout"), not: present("variant") }
      ]
    };
    definitions.schedule = object(
      {
        variant: nonblank,
        seed: shortString,
        stages: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: object({
            at: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            percentage: { type: "number", minimum: 0, maximum: 100 }
          }),
          description:
            "Runtime checks increasing timestamps, nondecreasing percentages and three decimal places."
        }
      },
      ["variant", "stages"]
    );
    properties.rules = { type: "array", maxItems: 100, items: ref("rule") };
    properties.disabledVariant = nonblank;
    properties.schedule = ref("schedule");
  }
  definitions.flag = {
    ...object(properties, ["type", "variants", "defaultVariant"]),
    allOf: ["boolean", "string", "number", "object"].map((type) => ({
      if: { properties: { type: { const: type } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword containing a schema, not a callback.
      then: {
        properties: {
          variants: {
            type: "object",
            additionalProperties:
              type === "object"
                ? {
                    anyOf: [
                      { type: "object", additionalProperties: ref("json") },
                      { type: "array", items: ref("json") }
                    ]
                  }
                : { type }
          }
        }
      }
    })),
    ...(version === 2 ? { not: present("rollout", "schedule") } : {})
  };
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `urn:openfeature-local-provider:snapshot:v${version}`,
    title: `OpenFeature Local Provider flag snapshot v${version}`,
    description:
      "Offline authoring schema. validateFlagSnapshot remains authoritative for semantic constraints; see docs/library/authoring.md.",
    ...object(
      {
        schemaVersion: { const: version },
        flags: { type: "object", propertyNames: nonblank, additionalProperties: ref("flag") },
        metadata: ref("metadata")
      },
      ["schemaVersion", "flags"]
    ),
    definitions
  };
}

if (mode === "--write") await mkdir(schemaDirectory, { recursive: true });
for (const version of [1, 2]) {
  const destination = new URL(`v${version}.json`, schemaDirectory);
  const expected = schema(version);
  if (mode === "--write") await writeFile(destination, `${JSON.stringify(expected, null, 2)}\n`);
  else if (!isDeepStrictEqual(JSON.parse(await readFile(destination, "utf8")), expected)) {
    throw new Error(
      `Generated schema is stale: ${fileURLToPath(destination)}; run pnpm schemas:generate`
    );
  }
}
console.log(`Snapshot schemas ${mode === "--write" ? "generated" : "verified"} (v1, v2).`);
