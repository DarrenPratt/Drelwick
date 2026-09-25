import { app, BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getMainWindowOptions } from "./window-options.js";

export { getMainWindowOptions };

export function getRendererUrl(): string {
  return (
    process.env["VITE_DEV_SERVER_URL"] ??
    pathToFileURL(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "renderer",
        "index.html",
      ),
    ).href
  );
}

export function createMainWindow(): BrowserWindow {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const preloadPath = join(
    currentDirectory,
    "..",
    "..",
    "preload",
    "preload.cjs",
  );
  const icons = join(app.getAppPath(), "assets", "icons");
  const window = new BrowserWindow({
    ...getMainWindowOptions(preloadPath),
    icon: join(icons, process.platform === "win32" ? "app.ico" : "app.png"),
  });
  app.dock?.setIcon(join(icons, "app.png"));

  const rendererUrl = getRendererUrl();
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL(rendererUrl);
  return window;
}
