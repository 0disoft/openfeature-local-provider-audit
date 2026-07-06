import type { FlagSnapshot } from "../src/public-types.js";

export const staticSnapshot: FlagSnapshot = {
  schemaVersion: 1,
  flags: {
    "checkout.enabled": {
      type: "boolean",
      defaultVariant: "on",
      variants: {
        on: true,
        off: false
      },
      metadata: {
        owner: "checkout"
      }
    },
    "checkout.copy": {
      type: "string",
      defaultVariant: "short",
      variants: {
        short: "Buy now",
        long: "Complete checkout"
      }
    },
    "checkout.limit": {
      type: "number",
      defaultVariant: "standard",
      variants: {
        standard: 5
      }
    },
    "checkout.config": {
      type: "object",
      defaultVariant: "default",
      variants: {
        default: {
          retries: 2,
          mode: "safe"
        }
      }
    }
  }
};
