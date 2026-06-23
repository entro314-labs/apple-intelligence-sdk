import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: ["esm", "cjs"],
  // Generate .d.ts via Oxc's isolated-declarations transformer (Rust) instead of the
  // TypeScript Compiler API, so the build needs no `typescript` "." export. Required
  // because the pinned tsgo 7.x preview ships no JS Compiler API.
  dts: { oxc: true },
  outDir: "dist",
  platform: "node",
  fixedExtension: true,
});
