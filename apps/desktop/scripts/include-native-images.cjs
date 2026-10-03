/* global process, __dirname */

const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");
const { readFileSync } = require("node:fs");

// This workspace's electron-builder 26.0.12 bundle omits Sharp's optional binaries.
// Resolve the installed native image packages rather than guessing store paths.
module.exports = async ({ packager }) => {
  const fromCore = createRequire(
    join(__dirname, "../../../packages/core/package.json"),
  );
  const sharpManifest = join(
    dirname(fromCore.resolve("sharp")),
    "../package.json",
  );
  const fromSharp = createRequire(sharpManifest);
  const sharp = JSON.parse(readFileSync(sharpManifest, "utf8"));
  let nativePackages = 0;
  for (const name of Object.keys(sharp.optionalDependencies)) {
    if (!name.startsWith("@img/sharp-")) continue;
    let manifest;
    try {
      manifest = fromSharp.resolve(`${name}/package`);
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") continue;
      throw error;
    }
    const metadata = JSON.parse(readFileSync(manifest, "utf8"));
    if (
      !metadata.os?.includes(process.platform) ||
      !metadata.cpu?.includes(process.arch)
    )
      continue;
    const destination = `node_modules/${name}`;
    // electron-builder.yml excludes these from automatic dependency copying.
    if (!packager.config.files.some((entry) => entry.to === destination)) {
      packager.config.files.push({
        from: dirname(manifest),
        to: destination,
        filter: ["**/*"],
      });
    }
    nativePackages++;
  }
  if (nativePackages === 0)
    throw new Error("Installed Sharp native image dependencies are missing");
};
