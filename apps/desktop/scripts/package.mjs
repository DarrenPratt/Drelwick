/* global process, URL */

import { spawn } from "node:child_process";
import { realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const root = await realpath(resolve(desktop, "../.."));
const require = createRequire(import.meta.url);
const builder = join(
  dirname(require.resolve("electron-builder/package.json")),
  "cli.js",
);
if (process.argv.slice(2).some((argument) => argument !== "--dir")) {
  throw new Error(
    "Use package or package:dir on the target host and architecture",
  );
}
const builds = process.argv.includes("--dir")
  ? [["--dir"]]
  : {
      win32: [
        ["--win", "portable", "--config.directories.output=release/portable"],
        ["--win", "nsis", "--config.directories.output=release/nsis"],
      ],
      darwin: [["--mac", "dmg"]],
      linux: [["--linux", "AppImage", "deb"]],
    }[process.platform];

if (!builds) {
  throw new Error(`Unsupported packaging platform: ${process.platform}`);
}

async function run(arguments_) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, arguments_, {
      stdio: "inherit",
      cwd: desktop,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Packaging command exited with ${code ?? signal}`));
    });
  });
}

// Clean only known compiler outputs. Refuse redirected/junction targets before
// deleting so packaging cannot follow a workspace link into author data.
for (const workspace of [
  "apps/desktop",
  "packages/core",
  "packages/project-model",
  "packages/renderer",
  "packages/shared",
]) {
  const output = join(root, workspace, "dist");
  try {
    if ((await realpath(output)) !== output)
      throw new Error(`Redirected build output: ${output}`);
    await rm(output, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (!process.env.npm_execpath) throw new Error("Run packaging through pnpm");
await run([
  process.env.npm_execpath,
  "--filter",
  "@drelwick/desktop...",
  "build",
]);
for (const target of builds) {
  await run([
    builder,
    "--config",
    "electron-builder.yml",
    "--publish",
    "never",
    ...target,
  ]);
}
