import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 89,
        branches: 85,
        functions: 97,
        lines: 89
      }
    }
  }
});
