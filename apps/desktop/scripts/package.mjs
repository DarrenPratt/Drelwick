/* global process */

import { spawn } from "node:child_process";

const builder =
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
const builds = {
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

for (const target of builds) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      builder,
      ["--config", "electron-builder.yml", "--publish", "never", ...target],
      {
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`electron-builder exited with ${code ?? signal}`));
    });
  });
}
