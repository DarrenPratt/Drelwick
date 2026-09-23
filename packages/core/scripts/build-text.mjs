import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { URL } from "node:url";

const parserRequire = createRequire(import.meta.resolve("parse5"));
const entitiesLicense = join(
  dirname(parserRequire.resolve("entities")),
  "../LICENSE",
);

const notices = await Promise.all([
  readFile(new URL("../node_modules/marked/LICENSE", import.meta.url), "utf8"),
  readFile(new URL("../node_modules/parse5/LICENSE", import.meta.url), "utf8"),
  readFile(entitiesLicense, "utf8"),
]);
await build({
  entryPoints: ["src/text-import/parser.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "TEXT",
  outfile: "dist/text-parser.bundle.js",
  banner: {
    js: `/*! Text parser dependencies: marked, parse5, entities.\n${notices.join("\n")}\n*/`,
  },
});
