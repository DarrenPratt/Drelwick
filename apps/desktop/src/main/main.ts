import { app, BrowserWindow } from "electron";

import { createMainWindow } from "./windows/main-window.js";

let mainWindow: BrowserWindow | undefined;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

void app.whenReady().then(() => {
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
