import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const notices = await Promise.all([
  readFile(new URL("../node_modules/fflate/LICENSE", import.meta.url), "utf8"),
  readFile(new URL("../node_modules/sax/LICENSE.md", import.meta.url), "utf8"),
]);
await build({
  entryPoints: ["src/docx/parser.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "DOCX",
  outfile: "dist/docx-parser.bundle.js",
  banner: {
    js: `/*! DOCX parser dependencies: fflate and sax.\n${notices.join("\n")}\n*/`,
  },
});
