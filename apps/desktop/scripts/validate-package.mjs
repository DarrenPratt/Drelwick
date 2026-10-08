/* global URL, console, process, setTimeout */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { extractFile, listPackage } from "@electron/asar";
import stopSmokeProcess from "./stop-smoke-process.cjs";

const desktopDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const platformDirectory = {
  win32:
    process.arch === "x64" ? "win-unpacked" : `win-${process.arch}-unpacked`,
  darwin: process.arch === "x64" ? "mac" : `mac-${process.arch}`,
  linux:
    process.arch === "x64"
      ? "linux-unpacked"
      : `linux-${process.arch}-unpacked`,
}[process.platform];

if (!platformDirectory) {
  throw new Error(
    `Unsupported packaging validation platform: ${process.platform}`,
  );
}

const applicationDirectory = resolve(
  desktopDirectory,
  process.argv
    .find((argument) => argument.startsWith("--app-dir="))
    ?.slice("--app-dir=".length) ?? join("release", platformDirectory),
);
const resourcesDirectory =
  process.platform === "darwin"
    ? join(applicationDirectory, "Drelwick.app", "Contents", "Resources")
    : join(applicationDirectory, "resources");
const archivePath = join(resourcesDirectory, "app.asar");
const executablePath =
  process.platform === "win32"
    ? join(applicationDirectory, "Drelwick.exe")
    : process.platform === "darwin"
      ? join(
          applicationDirectory,
          "Drelwick.app",
          "Contents",
          "MacOS",
          "Drelwick",
        )
      : join(applicationDirectory, "drelwick");

if (!existsSync(archivePath) || !existsSync(executablePath)) {
  throw new Error(
    `Expected packaged application is missing: ${archivePath} or ${executablePath}`,
  );
}

const entries = await listPackage(archivePath);
const normalizedEntries = entries.map((entry) =>
  entry.replaceAll("\\", "/").replace(/^\/+/, ""),
);
const requiredEntries = [
  "package.json",
  "dist/main/main.js",
  "dist/preload/preload.cjs",
  "dist/renderer/index.html",
  "assets/icons/app.png",
  "node_modules/@drelwick/core/dist/index.js",
  "node_modules/@drelwick/core/dist/docx-parser.bundle.js",
  "node_modules/@drelwick/core/dist/text-parser.bundle.js",
  "node_modules/@drelwick/project-model/dist/index.js",
  "node_modules/@drelwick/renderer/dist/index.js",
  "node_modules/@drelwick/shared/dist/index.js",
  "dist/main/spelling-worker.js",
  "dist/main/print-render.js",
  "dist/main/print-surface.js",
  "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "node_modules/@napi-rs/canvas/package.json",
  "node_modules/@fontsource/noto-serif/LICENSE",
  "node_modules/@fontsource/noto-sans/LICENSE",
  ...["noto-serif", "noto-sans"].flatMap((family) =>
    [400, 700].flatMap((weight) =>
      ["normal", "italic"].map(
        (style) =>
          `node_modules/@fontsource/${family}/files/${family}-latin-${weight}-${style}.woff`,
      ),
    ),
  ),
  "node_modules/dictionary-en/index.aff",
  "node_modules/dictionary-en/index.dic",
  "node_modules/dictionary-en-gb/index.aff",
  "node_modules/dictionary-en-gb/index.dic",
];
for (const entry of requiredEntries) {
  if (!normalizedEntries.includes(entry))
    throw new Error(`Missing packaged entry: ${entry}`);
}
const nativePdfFiles = normalizedEntries.filter((entry) =>
  /^node_modules\/@napi-rs\/canvas-.*\.node$/.test(entry),
);
if (!nativePdfFiles.length)
  throw new Error("Packaged PDF inspection native dependency is missing");
const nativeImageFiles = normalizedEntries.filter((entry) =>
  /^node_modules\/@img\/sharp-.*\.(node|dll|dylib|so(?:\..*)?)$/.test(entry),
);
if (!nativeImageFiles.some((entry) => entry.endsWith(".node"))) {
  throw new Error("Packaged Sharp native image dependency is missing");
}
for (const entry of [...nativeImageFiles, ...nativePdfFiles]) {
  if (!existsSync(join(`${archivePath}.unpacked`, entry))) {
    throw new Error(`Native image library was not unpacked: ${entry}`);
  }
}

const forbiddenFragments = [
  "/test/",
  "/tests/",
  "/fixtures/",
  "/.git/",
  "/coverage/",
  "/playwright-report/",
  "/test-results/",
  "/.history/",
  "/manuscript/",
  "/package-smoke-",
  ".env",
];
const forbiddenEntries = normalizedEntries.filter(
  (entry) =>
    forbiddenFragments.some((fragment) => `/${entry}`.includes(fragment)) ||
    /^node_modules\/@drelwick\/[^/]+\/(src|scripts)\//.test(entry) ||
    /\.(map|d\.[cm]?ts)$/.test(entry),
);
if (forbiddenEntries.length > 0) {
  throw new Error(
    `Development-only entries were packaged: ${forbiddenEntries.join(", ")}`,
  );
}

const packageJson = JSON.parse(
  extractFile(archivePath, "package.json").toString("utf8"),
);
if (packageJson.main !== "dist/main/main.js") {
  throw new Error(`Unexpected packaged main entry: ${packageJson.main}`);
}
const sourceManifest = JSON.parse(
  readFileSync(join(desktopDirectory, "package.json"), "utf8"),
);
if (packageJson.version !== sourceManifest.version) {
  throw new Error("Packaged version differs from the desktop manifest");
}
const rendererHtml = extractFile(
  archivePath,
  join("dist", "renderer", "index.html"),
).toString("utf8");
const rendererAssets = [
  ...rendererHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g),
];
if (!rendererAssets.some((match) => match[1].endsWith(".js"))) {
  throw new Error("Packaged renderer has no bundled script");
}
for (const [, asset] of rendererAssets) {
  if (!normalizedEntries.includes(`dist/renderer/${asset}`)) {
    throw new Error(`Missing renderer asset: ${asset}`);
  }
}
if (packageJson.devDependencies) {
  throw new Error(
    "Development dependencies were retained in the packaged manifest",
  );
}
if (
  !packageJson.dependencies ||
  Object.keys(packageJson.dependencies).length === 0
) {
  throw new Error("Packaged runtime dependencies are missing");
}

if (process.argv.includes("--inspect-only")) {
  console.log(
    `Inspected packaged Drelwick application: ${process.platform} (${normalizedEntries.length} asar entries)`,
  );
  process.exit(0);
}

const userDataDirectory = mkdtempSync(join(desktopDirectory, "package-smoke-"));
if (!userDataDirectory.startsWith(join(desktopDirectory, "package-smoke-"))) {
  throw new Error(
    "Refusing to use a smoke directory outside the desktop workspace",
  );
}
const smokeFile = join(userDataDirectory, "package-smoke-result.txt");
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
let child;
let launchError;
let windowsProcessId;
try {
  if (process.platform === "win32") {
    const command = [
      "$ErrorActionPreference='Stop'",
      `$env:DRELWICK_PACKAGE_SMOKE_FILE=${quotePowerShell(smokeFile)}`,
      `$process=Start-Process -FilePath ${quotePowerShell(executablePath)} -ArgumentList @(${quotePowerShell(`--user-data-dir="${userDataDirectory}"`)}) -WorkingDirectory ${quotePowerShell(applicationDirectory)} -WindowStyle Hidden -PassThru`,
      "$process.Id",
    ].join("; ");
    windowsProcessId = Number(
      execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
        encoding: "utf8",
      }).trim(),
    );
  } else {
    child = spawn(executablePath, [`--user-data-dir=${userDataDirectory}`], {
      cwd: applicationDirectory,
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        DRELWICK_PACKAGE_SMOKE_FILE: smokeFile,
      },
    });
    child.once("error", (error) => {
      launchError = error;
    });
  }

  const waitForRenderer = async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (existsSync(smokeFile)) return readFileSync(smokeFile, "utf8");
      if (launchError) throw launchError;
      if (child && (child.exitCode !== null || child.signalCode !== null)) {
        throw new Error(
          `Packaged application exited before loading: ${child.exitCode ?? child.signalCode}`,
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error("Packaged renderer did not complete its smoke marker");
  };

  const smokeResult = await waitForRenderer();
  if (smokeResult !== "renderer-and-preload-ok") {
    throw new Error(`Packaged runtime smoke failed: ${smokeResult}`);
  }
} finally {
  if (windowsProcessId) {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Stop-Process -Id ${windowsProcessId} -Force`,
    ]);
  } else {
    // This isolated smoke process has no manuscript to save. Wait for its exit
    // before removing its profile; Electron may intercept a graceful SIGTERM.
    await stopSmokeProcess(child);
  }
  rmSync(userDataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

console.log(
  `Validated packaged Drelwick application: ${process.platform} (${normalizedEntries.length} asar entries)`,
);
