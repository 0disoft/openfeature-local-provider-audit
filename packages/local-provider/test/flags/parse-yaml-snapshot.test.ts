import { describe, expect, it } from "vitest";
import { LOCAL_PROVIDER_ERROR_CODES } from "../../src/errors/error-codes.js";
import { isLocalProviderError } from "../../src/errors/local-provider-error.js";
import { evaluateFlag } from "../../src/evaluator/evaluate.js";
import { parseJsonFlagSnapshot } from "../../src/flags/parse-json-snapshot.js";
import { parseYamlFlagSnapshot } from "../../src/flags/parse-yaml-snapshot.js";

describe("parseYamlFlagSnapshot", () => {
  it("parses a valid schemaVersion 1 snapshot", () => {
    const snapshot = parseYamlFlagSnapshot(`
schemaVersion: 1
flags:
  checkout.enabled:
    type: boolean
    defaultVariant: "on"
    variants:
      "on": true
      "off": false
`);

    expect(snapshot.flags["checkout.enabled"]?.variants.on).toBe(true);
  });

  it("produces the same evaluation result as an equivalent JSON snapshot", () => {
    const jsonSnapshot = parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        flags: {
          "checkout.rollout": {
            type: "boolean",
            defaultVariant: "off",
            variants: {
              on: true,
              off: false
            },
            rollout: [
              {
                variant: "on",
                percentage: 50,
                seed: "checkout-rollout-v1"
              }
            ]
          }
        }
      })
    );
    const yamlSnapshot = parseYamlFlagSnapshot(`
schemaVersion: 1
flags:
  checkout.rollout:
    type: boolean
    defaultVariant: "off"
    variants:
      "on": true
      "off": false
    rollout:
      - variant: "on"
        percentage: 50
        seed: checkout-rollout-v1
`);

    const request = {
      flagKey: "checkout.rollout",
      defaultValue: false,
      expectedType: "boolean" as const,
      targetingKey: "user-alpha"
    };

    expect(evaluateFlag(jsonSnapshot, request)).toEqual(evaluateFlag(yamlSnapshot, request));
  });

  it("throws PARSE_ERROR for invalid YAML", () => {
    try {
      parseYamlFlagSnapshot("schemaVersion: [");
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });

  it("throws PARSE_ERROR for duplicate keys", () => {
    try {
      parseYamlFlagSnapshot(`
schemaVersion: 1
schemaVersion: 1
flags: {}
`);
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });

  it.each([1, 2])(
    "preserves a wide v%s mapping and rejects a duplicate at its tail",
    (schemaVersion) => {
      const entries = Array.from({ length: 1024 }, (_, i) => [`key-${i}`, i] as const);
      const yaml = `schemaVersion: ${schemaVersion}\nflags:\n  config:\n    type: object\n    defaultVariant: live\n    variants:\n      live:\n${entries.map(([key, value]) => `        ${key}: ${value}\n`).join("")}`;
      const expected = parseJsonFlagSnapshot(
        JSON.stringify({
          schemaVersion,
          flags: {
            config: {
              type: "object",
              defaultVariant: "live",
              variants: { live: Object.fromEntries(entries) }
            }
          }
        })
      );
      expect(JSON.stringify(parseYamlFlagSnapshot(yaml))).toBe(JSON.stringify(expected));
      expect(() => parseYamlFlagSnapshot(`${yaml}        key-0: -1\n`)).toThrowError(
        expect.objectContaining({ code: "PARSE_ERROR" })
      );
    }
  );

  it.each([
    "{ schemaVersion: 1, flags: { sample: { type: boolean, variants: { live: true, live: false }, defaultVariant: live } } }",
    "{ schemaVersion: 1, flags: { sample: { type: object, variants: { live: [{ key: 1, key: 2 }] }, defaultVariant: live } } }"
  ])("rejects duplicate flow-map keys at variant and array-element boundaries", (yaml) => {
    expect(() => parseYamlFlagSnapshot(yaml)).toThrowError(
      expect.objectContaining({ code: "PARSE_ERROR" })
    );
  });

  it.each([
    ["1", '"1"'],
    ["true", '"true"'],
    ["false", '"false"'],
    ["0x10", '"16"'],
    ["1.0", '"1"'],
    ["null", '""'],
    ["&key 1", "*key"]
  ])("rejects object-key collisions between %s and %s before values are lost", (left, right) => {
    const yaml = `schemaVersion: 1\nflags:\n  critical:\n    type: object\n    variants:\n      on:\n        ${left} : true\n        ${right} : false\n    defaultVariant: on\n`;
    expect(() => parseYamlFlagSnapshot(yaml)).toThrowError(
      expect.objectContaining({ code: "PARSE_ERROR" })
    );
  });

  it.each([1, 2])("rejects colliding flag names in schema v%s", (version) => {
    const flag = "{ type: boolean, variants: { on: true }, defaultVariant: on }";
    expect(() =>
      parseYamlFlagSnapshot(`schemaVersion: ${version}\nflags:\n  1: ${flag}\n  "1": ${flag}\n`)
    ).toThrowError(expect.objectContaining({ code: "PARSE_ERROR" }));
  });

  it("rejects colliding variants instead of silently reversing the default flag value", () => {
    expect(() =>
      parseYamlFlagSnapshot(
        `schemaVersion: 1\nflags:\n  critical:\n    type: boolean\n    variants:\n      1: true\n      "1": false\n    defaultVariant: "1"\n`
      )
    ).toThrowError(expect.objectContaining({ code: "PARSE_ERROR" }));
  });

  it("checks aliases from earlier values and keeps mappings independent", () => {
    const yaml = `schemaVersion: 1\nflags:\n  sample:\n    type: object\n    variants:\n      on:\n        first: &key 1\n        nested:\n          *key : first\n          "1": second\n    defaultVariant: on\n`;
    expect(() => parseYamlFlagSnapshot(yaml)).toThrowError(
      expect.objectContaining({ code: "PARSE_ERROR" })
    );
    expect(
      parseYamlFlagSnapshot(yaml.replace('          "1": second', '          "2": second')).flags
        .sample
    ).toBeDefined();
  });

  it("preserves unambiguous scalar keys, scalar aliases and anchor redefinition", () => {
    // Anchors are values here; each alias must retain the latest preceding anchor.
    const snapshot = parseYamlFlagSnapshot(
      `schemaVersion: 1\nflags:\n  sample:\n    type: object\n    variants:\n      on:\n        number: &key 1\n        *key : one\n        boolean: &key true\n        *key : yes\n        2.0: two\n        null: empty\n        text: &value hello\n        copy: *value\n    defaultVariant: on\n`
    );
    expect(snapshot).toEqual(
      parseJsonFlagSnapshot(
        JSON.stringify({
          schemaVersion: 1,
          flags: {
            sample: {
              type: "object",
              variants: {
                on: {
                  number: 1,
                  "1": "one",
                  boolean: true,
                  true: "yes",
                  "2": "two",
                  "": "empty",
                  text: "hello",
                  copy: "hello"
                }
              },
              defaultVariant: "on"
            }
          }
        })
      )
    );
  });

  it.each(["[a, b]", "{ a: b }"])(
    "rejects collection keys %s instead of implicitly stringifying them",
    (key) => {
      expect(() =>
        parseYamlFlagSnapshot(
          `schemaVersion: 1\nflags:\n  sample:\n    type: object\n    variants:\n      on:\n        ? ${key}\n        : secret\n    defaultVariant: on\n`
        )
      ).toThrowError(expect.objectContaining({ code: "PARSE_ERROR" }));
    }
  );

  it("normalizes YAML alias exhaustion to PARSE_ERROR", () => {
    const aliases = Array.from({ length: 101 }, () => "  - *base").join("\n");

    try {
      parseYamlFlagSnapshot(`base: &base { value: true }\nrefs:\n${aliases}\n`);
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.PARSE_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });

  it("throws SCHEMA_ERROR for invalid snapshot schema", () => {
    try {
      parseYamlFlagSnapshot(`
schemaVersion: 1
flags: []
`);
    } catch (error) {
      expect(isLocalProviderError(error)).toBe(true);
      if (isLocalProviderError(error)) {
        expect(error.code).toBe(LOCAL_PROVIDER_ERROR_CODES.SCHEMA_ERROR);
      }
      return;
    }

    throw new Error("Expected parseYamlFlagSnapshot to throw.");
  });
});

it("rejects scalar alias amplification beyond the snapshot byte budget", () => {
  const scalar = "x".repeat(2 * 1024 * 1024);
  const aliases = Array.from({ length: 64 }, (_, i) => `      copy${i}: *large`).join("\n");
  const yaml = `schemaVersion: 1\nflags:\n  payload:\n    type: string\n    defaultVariant: base\n    variants:\n      base: &large ${scalar}\n${aliases}\n`;
  expect(Buffer.byteLength(yaml)).toBeLessThan(3 * 1024 * 1024);
  expect(scalar.length * 65).toBe(130 * 1024 * 1024);
  expect(() => parseYamlFlagSnapshot(yaml)).toThrowError(
    expect.objectContaining({ code: "SCHEMA_ERROR" })
  );
});

it("retains small scalar aliases and identical JSON values", () => {
  const snapshot = parseYamlFlagSnapshot(
    `schemaVersion: 1\nflags:\n  text:\n    type: string\n    defaultVariant: base\n    variants:\n      base: &value "가😀"\n      copy: *value\n`
  );
  expect(snapshot.flags.text?.variants).toEqual({ base: "가😀", copy: "가😀" });
});
