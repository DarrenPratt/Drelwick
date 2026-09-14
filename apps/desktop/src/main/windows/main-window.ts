import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getMainWindowOptions } from "./window-options.js";

export { getMainWindowOptions };

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

  const rendererUrl = process.env["VITE_DEV_SERVER_URL"];
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(
      join(currentDirectory, "..", "..", "renderer", "index.html"),
    );
  }
  return window;
}
