// Shared, platform-neutral contract: real runtimes consume identical packed bytes/cases.
export function runCoreContract(api) {
  const results = [];
  for (const when of [
    { attribute: ["tenant"], op: "exists", value: true },
    { attribute: ["tenant"], op: "exists", value: false },
    { not: { attribute: ["tenant"], op: "eq", value: "blocked" } },
    {
      not: {
        all: [
          { attribute: ["tenant"], op: "eq", value: "blocked" },
          { attribute: ["missing"], op: "eq", value: "x" }
        ]
      }
    }
  ]) {
    const snapshot = api.parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          predicate: {
            type: "boolean",
            variants: { on: true, off: false },
            defaultVariant: "off",
            rules: [{ id: "safe", when, variant: "on" }]
          }
        }
      })
    );
    for (const context of [
      {},
      { tenant: undefined },
      { tenant: null },
      { tenant: "allowed" },
      { tenant: "blocked" },
      { tenant: 1 },
      { tenant: {} },
      Object.create({ tenant: "allowed" }),
      Object.defineProperty({}, "tenant", {
        get() {
          throw new Error("Getter invoked");
        }
      })
    ]) {
      const result = api.evaluateFlag(snapshot, {
        flagKey: "predicate",
        expectedType: "boolean",
        defaultValue: false,
        context
      });
      const own = Object.getOwnPropertyDescriptor(context, "tenant");
      const invalid = own ? !("value" in own) : "tenant" in context;
      const present = own && own.value !== undefined;
      const expected =
        "op" in when
          ? !invalid && (when.value ? !!present : !present)
          : "all" in when.not
            ? false
            : !invalid && own?.value === "allowed";
      if (result.value !== expected) throw new Error("Presence/negation contract failed");
      results.push(result);
    }
  }
  for (const size of [15, 16, 100]) {
    const values = [...Array.from({ length: size - 3 }, (_, i) => `member-${i}`), 0, false, null];
    const snapshot = api.parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          guarded: {
            type: "boolean",
            variants: { on: true, off: false },
            defaultVariant: "off",
            rules: [
              {
                id: "guarded",
                when: { not: { attribute: ["member"], op: "in", value: values } },
                variant: "on"
              }
            ]
          }
        }
      })
    );
    for (const [member, expected] of [
      [0, false],
      [1, true],
      [null, false],
      [false, false],
      [true, true],
      ["absent", true],
      [undefined, false],
      [NaN, false],
      [{}, false]
    ]) {
      const result = api.evaluateFlag(snapshot, {
        flagKey: "guarded",
        expectedType: "boolean",
        defaultValue: false,
        context: { member }
      });
      if (result.value !== expected) throw new Error("Guarded membership type index failed");
      results.push(result);
    }
  }
  for (const op of ["startsWith", "endsWith"]) {
    const snapshot = api.parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          text: {
            type: "boolean",
            variants: { on: true, off: false },
            defaultVariant: "off",
            rules: [
              { id: "literal", when: { attribute: ["tenant"], op, value: "😀" }, variant: "on" }
            ]
          }
        }
      })
    );
    for (const actual of ["😀tenant", "tenant😀", "😀", "", null, 1, "x".repeat(4097)]) {
      const result = api.evaluateFlag(snapshot, {
        flagKey: "text",
        expectedType: "boolean",
        defaultValue: false,
        context: { tenant: actual }
      });
      const expected =
        typeof actual === "string" &&
        (op === "startsWith" ? actual.startsWith("😀") : actual.endsWith("😀"));
      if (result.value !== expected) throw new Error("Literal string targeting failed.");
      results.push(result);
    }
  }
  for (const seed of [undefined, "seed", "한국어😀", "\ud800"]) {
    const rollout = [
      { variant: "on", percentage: 37.123, ...(seed === undefined ? {} : { seed }) }
    ];
    const definition = {
      type: "boolean",
      defaultVariant: "off",
      variants: { on: true, off: false }
    };
    const snapshot = api.parseJsonFlagSnapshot(
      JSON.stringify({
        schemaVersion: 2,
        flags: {
          rollout: { ...definition, rollout },
          target: {
            ...definition,
            rules: [
              {
                id: "version",
                when: { attribute: ["version"], op: "semverGte", value: "2.0.0" },
                rollout
              }
            ]
          },
          membership: {
            ...definition,
            rules: [
              {
                id: "member",
                when: {
                  attribute: ["member"],
                  op: "in",
                  value: Array.from({ length: 100 }, (_, index) => `member-${index}`)
                },
                variant: "on"
              }
            ]
          },
          schedule: {
            ...definition,
            schedule: {
              variant: "on",
              ...(seed === undefined ? {} : { seed }),
              stages: [
                { at: 10, percentage: 25 },
                { at: 20, percentage: 100 }
              ]
            }
          },
          disabled: { ...definition, disabledVariant: "off", rollout }
        }
      })
    );
    if (!Object.isFrozen(snapshot.flags.rollout.variants)) throw new Error("Snapshot is mutable.");
    for (const subject of ["ascii", "한국어", "😀", "e\u0301", "a\nb", "\ud800", "\udfff", ""]) {
      for (let index = 0; index < 8; index++) {
        for (const flagKey of [
          "rollout",
          "target",
          "membership",
          "schedule",
          "disabled",
          "missing"
        ]) {
          const request = {
            flagKey,
            expectedType: "boolean",
            defaultValue: false,
            targetingKey: `${subject}${index}`,
            context: {
              version: index % 2 ? "2.0.0" : "1.0.0",
              member: index % 2 ? "member-99" : "missing"
            },
            evaluationTime: [0, 9, 10, 19, 20, 21, 100, 5][index]
          };
          const result = api.evaluateFlag(snapshot, request);
          results.push(result);
          if (flagKey === "schedule" && index === 4 && result.value !== true)
            throw new Error("Final stage not fully enabled.");
          if (flagKey === "disabled" && result.value !== false)
            throw new Error("Emergency disable failed.");
          if (flagKey === "membership" && result.value !== Boolean(index % 2))
            throw new Error("Indexed membership failed.");
          if (index === 0)
            results.push(
              api.evaluateFlag(snapshot, {
                ...request,
                overrides: { values: { [flagKey]: true }, errors: {} }
              })
            );
        }
      }
    }
    results.push(
      api.evaluateFlag(snapshot, {
        flagKey: "schedule",
        expectedType: "boolean",
        defaultValue: false
      })
    );
  }
  const v1 = api.parseJsonFlagSnapshot(
    '{"schemaVersion":1,"flags":{"number":{"type":"number","defaultVariant":"one","variants":{"one":1}},"string":{"type":"string","defaultVariant":"on","variants":{"on":"한국어😀"}},"object":{"type":"object","defaultVariant":"on","variants":{"on":{"list":[true,null,1,"text"],"settings":{"enabled":true}}}}}}'
  );
  results.push(
    api.evaluateFlag(v1, { flagKey: "number", expectedType: "number", defaultValue: 0 })
  );
  results.push(
    api.evaluateFlag(v1, { flagKey: "number", expectedType: "boolean", defaultValue: false })
  );
  results.push(
    api.evaluateFlag(v1, { flagKey: "string", expectedType: "string", defaultValue: "fallback" })
  );
  results.push(
    api.evaluateFlag(v1, { flagKey: "object", expectedType: "object", defaultValue: null })
  );
  results.push(
    api.evaluateFlag(v1, {
      flagKey: "object",
      expectedType: "object",
      defaultValue: {},
      overrides: { values: { object: null }, errors: {} }
    })
  );
  const parseErrors = [];
  for (const invalid of ["invalid", "{}", '{"schemaVersion":3,"flags":{}}']) {
    try {
      api.parseJsonFlagSnapshot(invalid);
      throw new Error("Invalid input accepted.");
    } catch (error) {
      if (!api.isLocalProviderError(error)) throw error;
      parseErrors.push({ code: error.code, message: error.message });
    }
  }
  return {
    results,
    parseErrors,
    exports: Object.keys(api)
      .filter((name) =>
        [
          "evaluateFlag",
          "parseJsonFlagSnapshot",
          "LocalProviderError",
          "isLocalProviderError",
          "LOCAL_PROVIDER_ERROR_CODES",
          "EVALUATION_REASONS",
          "EVALUATION_SOURCES"
        ].includes(name)
      )
      .sort()
  };
}
