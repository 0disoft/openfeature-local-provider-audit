import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 87,
        branches: 83,
        functions: 96,
        lines: 87
      }
    }
  }
});
