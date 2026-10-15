import { defineConfig } from "tsdown";

export default defineConfig({
  copy: [
    {
      from: "src/collaboration-mode-templates/*",
      to: "dist/collaboration-mode-templates",
    },
  ],
  entry: ["src/cli.ts", "src/api-schema.ts"],
  format: "esm",
  outDir: "dist",
  clean: true,
  fixedExtension: false,
  hash: false,
  platform: "node",
  target: "node22.14",
});
