import { evaluateFlag, parseJsonFlagSnapshot } from "@0disoft/openfeature-local-provider/core";

// In an application, obtain configuration from a trusted, bounded loader.
// This self-contained preview uses public example data and explicit fixed times.
const launchAt = Date.UTC(2026, 9, 22);
const finalAt = launchAt + 60 * 60 * 1000;
const configuration = {
  schemaVersion: 2,
  flags: {
    "checkout.enabled": {
      type: "boolean",
      defaultVariant: "off",
      variants: { on: true, off: false },
      rules: [
        {
          id: "internal-preview",
          when: { attribute: ["tenant"], op: "eq", value: "internal" },
          variant: "on"
        }
      ],
      schedule: {
        variant: "on",
        seed: "checkout-v1",
        stages: [
          { at: launchAt, percentage: 25 },
          { at: finalAt, percentage: 100 }
        ]
      }
    }
  }
};
const snapshot = parseJsonFlagSnapshot(JSON.stringify(configuration));
const cohortSize = 200;
const request = (targetingKey, evaluationTime) => ({
  flagKey: "checkout.enabled",
  expectedType: "boolean",
  defaultValue: false,
  targetingKey,
  evaluationTime,
  context: { tenant: "public" }
});
let previous = new Set();
const stages = [launchAt - 1, launchAt, finalAt].map((evaluationTime) => {
  const enabled = new Set();
  for (let index = 0; index < cohortSize; index++) {
    // Stable non-personal example keys; never write real subject IDs to output.
    if (evaluateFlag(snapshot, request(`example-subject-${index}`, evaluationTime)).value)
      enabled.add(index);
  }
  if ([...previous].some((index) => !enabled.has(index)))
    throw new Error("Expanding rollout lost an existing member.");
  previous = enabled;
  return { evaluationTime, enabled: enabled.size };
});
if (
  stages[0].enabled !== 0 ||
  stages[2].enabled !== cohortSize ||
  stages[1].enabled <= 0 ||
  stages[1].enabled >= cohortSize
)
  throw new Error("Unexpected rollout preview.");

const internal = evaluateFlag(snapshot, {
  ...request("example-internal", launchAt - 1),
  context: { tenant: "internal" }
});
if (internal.reason !== "TARGETING_MATCH" || !internal.value)
  throw new Error("Internal preview did not win before the schedule.");

const stopped = parseJsonFlagSnapshot(
  JSON.stringify({
    ...configuration,
    flags: {
      "checkout.enabled": { ...configuration.flags["checkout.enabled"], disabledVariant: "off" }
    }
  })
);
const emergency = evaluateFlag(stopped, {
  ...request("example-internal", finalAt),
  context: { tenant: "internal" },
  overrides: { values: { "checkout.enabled": true }, errors: {} }
});
if (emergency.reason !== "DISABLED" || emergency.value !== false)
  throw new Error("Emergency stop did not override targeting and explicit overrides.");

// Only aggregate counts and reasons leave this preview; no subjects or contexts.
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      cohortSize,
      stages,
      internalPreview: internal.reason,
      emergencyStop: emergency.reason
    },
    null,
    2
  )
);
