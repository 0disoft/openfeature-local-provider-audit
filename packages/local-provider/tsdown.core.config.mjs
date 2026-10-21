import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/core.ts"],
  format: ["esm", "cjs"],
  platform: "neutral",
  inputOptions: { resolve: { mainFields: ["module", "main"] } },
  deps: { alwaysBundle: [/^@noble\/hashes(?:\/|$)/, /^semver(?:\/|$)/] },
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  fixedExtension: false,
  sourcemap: true,
  clean: false,
  dts: { generator: "tsgo", compilerOptions: { skipLibCheck: false } }
});
