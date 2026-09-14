import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getMainWindowOptions } from "./window-options.js";

export { getMainWindowOptions };

function getRendererDocument(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>BookEditor</title>
  </head>
  <body>
    <main>
      <h1>BookEditor</h1>
      <p>Your manuscript workspace is ready.</p>
    </main>
  </body>
</html>`;
}

export function createMainWindow(): BrowserWindow {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const preloadPath = join(
    currentDirectory,
    "..",
    "..",
    "preload",
    "preload.js",
  );
  const window = new BrowserWindow(getMainWindowOptions(preloadPath));

  void window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(getRendererDocument())}`,
  );
  return window;
}
