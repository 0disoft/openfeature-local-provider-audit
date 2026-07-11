import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 95,
        lines: 85
      }
    }
  }
});
