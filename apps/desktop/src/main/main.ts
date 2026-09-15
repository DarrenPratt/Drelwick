import { app, BrowserWindow } from "electron";

import { createMainWindow, getRendererUrl } from "./windows/main-window.js";
import { registerProjectCreationHandlers } from "./ipc/project-creation.js";

let mainWindow: BrowserWindow | undefined;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

void app.whenReady().then(() => {
  registerProjectCreationHandlers(() => mainWindow, getRendererUrl());
  createApplicationWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createApplicationWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
