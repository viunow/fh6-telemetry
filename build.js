import * as esbuild from "esbuild";
import { writeFileSync, mkdirSync, existsSync } from "fs";

// Ensure dist directory
if (!existsSync("dist")) {
  mkdirSync("dist", { recursive: true });
}

// Bundle ESM source to CJS for pkg packaging
await esbuild.build({
  entryPoints: ["src/index.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.cjs",
  banner: {
    js: "// Auto-generated CJS bundle for pkg packaging - DO NOT EDIT\nvar __dirname = require('path').dirname(__filename);",
  },
  define: {
    "import.meta.url": "undefined",
  },
});

console.log("[esbuild] bundled to dist/index.cjs");
