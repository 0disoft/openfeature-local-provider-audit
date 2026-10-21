import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  platform: "node",
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: {
    generator: "tsgo",
    compilerOptions: { skipLibCheck: false }
  }
});
