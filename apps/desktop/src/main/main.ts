import { app, BrowserWindow } from "electron";

import { createMainWindow, getRendererUrl } from "./windows/main-window.js";
import { registerProjectHandlers } from "./ipc/project-handlers.js";
import { RecentProjects } from "./recent-projects.js";
import { installApplicationMenu } from "./application-menu.js";

let mainWindow: BrowserWindow | undefined;

function createApplicationWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

void app.whenReady().then(() => {
  registerProjectHandlers(() => mainWindow, getRendererUrl(), {
    recents: new RecentProjects(app.getPath("userData")),
  });
  createApplicationWindow();
  installApplicationMenu();

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
